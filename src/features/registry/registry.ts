// Implements the server part of: https://docs.docker.com/registry/spec/auth/token/
// Reference: https://docs.docker.com/registry/spec/auth/jwt/

import type { Request, RequestHandler } from 'express';
import * as jsonwebtoken from 'jsonwebtoken';
import * as _ from 'lodash';
import { multiCacheMemoizee, reqPermissionNormalizer } from '../../infra/cache';
import { randomUUID } from 'crypto';

import { sbvrUtils, permissions, errors } from '@balena/pinejs';

import { captureException, handleHttpErrors } from '../../infra/error-handling';

import { registryAuth as CERT } from './certs';
import {
	AUTH_RESINOS_REGISTRY_CODE,
	MINUTES,
	REGISTRY2_HOST,
	RESOLVE_IMAGE_ID_CACHE_TIMEOUT,
	RESOLVE_IMAGE_READ_ACCESS_CACHE_TIMEOUT,
	TOKEN_AUTH_BUILDER_TOKEN,
} from '../../lib/config';
import type { Image, User as DbUser } from '../../balena-model';

const { UnauthorizedError } = errors;
const { api } = sbvrUtils;

// Set a large expiry so that huge pulls/pushes go through
// without needing to re-authenticate mid-process.
const TOKEN_EXPIRY_MINUTES = 240; // 4 hours

const RESINOS_REPOSITORY = 'resin/resinos';
const SUPERVISOR_REPOSITORIES = /^resin\/(?:[a-zA-Z0-9]+-)+supervisor$/;

const NEW_REGISTRY_REGEX = /(^(\d+)\/[\d\-]+$|^(v2\/[a-z0-9]+)(-[0-9]+)?)/;

// This regex parses a scope of the form
// 		repository:<image>:<permissions>
// 	where <image> can be
// 		<appname>/<commit>
// 		<appID>/<buildId>
// 		v2/<hash>
// 		resin/resinos (and related "standard" image names)
//
// 		with an optional tag or content digest on each kind
// 	where <permissions> can be a comma separated list of permissions, e.g.
// 		pull
// 		push
// 		push,pull
const SCOPE_PARSE_REGEX =
	/^([a-z]+):([a-z0-9_-]+\/[a-z0-9_-]+|\d+\/[\d\-]+|v2\/[a-z0-9]+-[0-9]+)(?::[a-z0-9]+|@sha256:[a-f0-9]+)?:((?:push|pull|,)+)$/;

export interface Access {
	name: string;
	type: string;
	actions: string[];
}
type Scope = [Access['type'], Access['name'], Access['actions']];

const parseScope = (req: Request, scope: string): Scope | undefined => {
	try {
		if (!scope) {
			return;
		}

		const params = scope.match(SCOPE_PARSE_REGEX);

		if (params == null) {
			return;
		}

		if (params[1] !== 'repository') {
			return;
		}

		return [params[1], params[2], params[3].split(',')];
	} catch (err) {
		captureException(err, `Failed to parse scope '${scope}'`, { req });
	}
	return;
};

const grantAllToBuilder = (parsedScopes: Scope[]): Access[] =>
	parsedScopes.map((scope) => {
		const [type, name, requestedActions] = scope;
		let allowedActions = ['pull', 'push'];
		if (name === RESINOS_REPOSITORY) {
			allowedActions = ['pull'];
		}
		if (SUPERVISOR_REPOSITORIES.test(name)) {
			allowedActions = ['pull'];
		}
		return {
			type,
			name,
			actions: _.intersection(requestedActions, allowedActions),
		};
	});

const resolveReadAccess = (() => {
	const $resolveReadAccess = multiCacheMemoizee(
		async (
			imageId: number,
			req: permissions.PermissionReq,
			tx: Tx,
		): Promise<boolean> => {
			const image = await api.resin.get({
				resource: 'image',
				id: imageId,
				passthrough: { req, tx },
				options: {
					$select: 'id',
				},
			});
			return image != null;
		},
		{
			cacheKey: 'resolveReadAccess',
			promise: true,
			primitive: true,
			maxAge: RESOLVE_IMAGE_READ_ACCESS_CACHE_TIMEOUT,
			normalizer: ([imageId, req]) => {
				return `${imageId}$${reqPermissionNormalizer(req)}`;
			},
		},
	);
	return async (
		req: Request,
		imageId: number | undefined,
		tx: Tx,
	): Promise<boolean> => {
		if (imageId == null) {
			return false;
		}
		return await $resolveReadAccess(imageId, req, tx);
	};
})();

const resolveWriteAccess = async (
	req: Request,
	imageId: number | undefined,
	tx: Tx,
): Promise<boolean> => {
	if (imageId == null) {
		return false;
	}
	try {
		const res = await api.resin.post({
			url: `image(${imageId})/canAccess`,
			passthrough: { req, tx },
			body: { action: 'push' },
		});
		return res.d?.[0]?.id === imageId;
	} catch (err) {
		if (!(err instanceof UnauthorizedError)) {
			captureException(err, 'Failed to resolve registry write access', {
				req,
			});
		}
		return false;
	}
};

const resolveImageId = multiCacheMemoizee(
	async (effectiveName: string, tx: Tx): Promise<number | undefined> => {
		const [image] = (await api.resin.get({
			resource: 'image',
			passthrough: { req: permissions.root, tx },
			options: {
				$select: ['id'],
				$filter: {
					is_stored_at__image_location: {
						$endswith: effectiveName,
					},
				},
			},
		})) as Array<Pick<Image, 'id'>>;
		return image?.id;
	},
	{
		cacheKey: 'resolveImageId',
		undefinedAs: false,
		promise: true,
		primitive: true,
		maxAge: RESOLVE_IMAGE_ID_CACHE_TIMEOUT,
		max: 500,
		normalizer: ([effectiveName]) => effectiveName,
	},
);

const resolveAccess = async (
	req: Request,
	type: string,
	name: string,
	effectiveName: string,
	requestedActions: string[],
	defaultActions: string[] = [],
	tx: Tx,
): Promise<Access> => {
	let allowedActions;
	// Do as few queries as possible
	const needsPull =
		requestedActions.includes('pull') && !defaultActions.includes('pull');
	const needsPush =
		requestedActions.includes('push') && !defaultActions.includes('push');
	if (!needsPush && !needsPull) {
		allowedActions = defaultActions;
	} else {
		try {
			const imageId = await resolveImageId(effectiveName, tx);
			const [hasReadAccess, hasWriteAccess] = await Promise.all([
				needsPull && resolveReadAccess(req, imageId, tx),
				needsPush && resolveWriteAccess(req, imageId, tx),
			]);

			const actions = _.clone(defaultActions);
			if (hasReadAccess) {
				actions.push('pull');
			}
			if (hasWriteAccess) {
				actions.push('push');
			}
			allowedActions = actions;
		} catch (err) {
			if (!(err instanceof UnauthorizedError)) {
				captureException(err, 'Failed to resolve registry access', { req });
			}
			allowedActions = defaultActions;
		}
	}

	return {
		name,
		type,
		actions: _.intersection(requestedActions, allowedActions),
	};
};

const authorizeRequest = async (
	req: Request,
	scopes: string[],
	tx: Tx,
): Promise<Access[]> => {
	const parsedScopes: Scope[] = _(scopes)
		.map((scope) => parseScope(req, scope))
		.compact()
		.value();

	if (req.params['apikey'] === TOKEN_AUTH_BUILDER_TOKEN) {
		return grantAllToBuilder(parsedScopes);
	}

	return await Promise.all(
		parsedScopes.map(async ([type, name, requestedActions]) => {
			if (name === RESINOS_REPOSITORY) {
				let allowedActions = ['pull'];
				if (
					AUTH_RESINOS_REGISTRY_CODE != null &&
					req.params['apikey'] === AUTH_RESINOS_REGISTRY_CODE
				) {
					allowedActions = ['pull', 'push'];
				}
				return {
					type,
					name,
					actions: _.intersection(requestedActions, allowedActions),
				};
			} else if (SUPERVISOR_REPOSITORIES.test(name)) {
				let allowedActions = ['pull'];
				if (
					AUTH_RESINOS_REGISTRY_CODE != null &&
					req.params['apikey'] === AUTH_RESINOS_REGISTRY_CODE
				) {
					allowedActions = ['pull', 'push'];
				}
				return {
					type,
					name,
					actions: _.intersection(requestedActions, allowedActions),
				};
			} else {
				const match = name.match(NEW_REGISTRY_REGEX);
				if (match != null) {
					// request for new-style, authenticated v2/randomhash image
					let effectiveName = name;
					if (match[4] != null) {
						// This is a multistage image, use the root image name
						effectiveName = match[3];
					}
					return await resolveAccess(
						req,
						type,
						name,
						effectiveName,
						requestedActions,
						undefined,
						tx,
					);
				} else {
					// request for legacy public-read appName/commit image
					return await resolveAccess(
						req,
						type,
						name,
						name,
						requestedActions,
						['pull'],
						tx,
					);
				}
			}
		}),
	);
};

const generateToken = (
	subject: string = '',
	audience: string,
	access: Access[],
): string => {
	const payload = {
		jti: randomUUID(),
		nbf: Math.floor(Date.now() / 1000) - 10,
		access,
	};
	const options = {
		algorithm: CERT.algo,
		issuer: CERT.issuer,
		audience,
		subject,
		expiresIn: 60 * TOKEN_EXPIRY_MINUTES,
		keyid: CERT.kid,
	};
	return jsonwebtoken.sign(payload, CERT.key, options);
};

export const token: RequestHandler = async (req, res) => {
	try {
		const { scope } = req.query;
		let scopes: string[];
		if (typeof scope === 'string') {
			scopes = [scope];
		} else if (Array.isArray(scope)) {
			scopes = scope as string[];
		} else if (_.isObject(scope)) {
			scopes = Object.values(scope) as string[];
		} else {
			scopes = [];
		}

		const [sub, access] = await sbvrUtils.db.readTransaction(
			async (tx) =>
				await Promise.all([
					getSubject(req, tx),
					authorizeRequest(req, scopes, tx),
				]),
		);
		res.json({
			token: generateToken(sub, REGISTRY2_HOST, access!),
		});
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		res.status(400).end(); // bad request
	}
};

const $getSubject = multiCacheMemoizee(
	async (
		apiKey: string,
		subject: string | undefined,
		tx: Tx,
	): Promise<string | undefined> => {
		if (subject) {
			try {
				// Try to resolve as a device api key first, using the passed in subject
				const device = await api.resin.get({
					resource: 'device',
					passthrough: { req: permissions.root, tx },
					id: {
						// uuids are passed as `d_${uuid}`
						uuid: subject.replace(/^d_/, ''),
					},
					options: {
						$select: ['id'],
						$filter: {
							actor: {
								$any: {
									$alias: 'a',
									$expr: {
										a: {
											api_key: {
												$any: {
													$alias: 'k',
													$expr: { k: { key: apiKey } },
												},
											},
										},
									},
								},
							},
						},
					},
				});
				if (device != null) {
					return subject;
				}
			} catch {
				// Ignore errors
			}
		}
		// If resolving as a device api key fails then instead try to resolve to the user api key username
		const [user] = (await api.resin.get({
			resource: 'user',
			passthrough: { req: permissions.root },
			options: {
				$select: 'username',
				$filter: {
					actor: {
						$any: {
							$alias: 'a',
							$expr: {
								a: {
									api_key: {
										$any: {
											$alias: 'k',
											$expr: {
												k: { key: apiKey },
											},
										},
									},
								},
							},
						},
					},
				},
				$top: 1,
			},
		})) as [Pick<DbUser, 'username'>?];
		if (user) {
			return user.username;
		}
	},
	{
		cacheKey: '$getSubject',
		undefinedAs: false,
		promise: true,
		maxAge: 5 * MINUTES,
		primitive: true,
		normalizer: ([apiKey, subject]) => `${apiKey}\u0001${subject}`,
	},
);
const getSubject = async (
	req: Request,
	tx: Tx,
): Promise<undefined | string> => {
	if (req.apiKey != null && !_.isEmpty(req.apiKey.permissions)) {
		return await $getSubject(req.apiKey.key, req.params.subject, tx);
	} else if (req.user) {
		// If there's no api key then try to use the username from the JWT
		return req.user.username;
	}
};
