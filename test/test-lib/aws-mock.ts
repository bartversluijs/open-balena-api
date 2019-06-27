import * as AWS from 'aws-sdk';
import * as Promise from 'bluebird';
import * as _ from 'lodash';
import * as mockery from 'mockery';

import $getObjectMocks = require('../fixtures/aws-s3/getObject.json');
import listObjectsV2Mocks = require('../fixtures/aws-s3/listObjectsV2.json');

// AWS S3 Client getObject results have a Buffer on their Body prop
// and a Date on their LastModified prop so we have to reconstruct
// them from the strings that the mock object holds
const getObjectMocks: Dictionary<AWS.S3.Types.GetObjectOutput> = _.mapValues(
	$getObjectMocks,
	(
		getObjectMock: typeof $getObjectMocks[keyof typeof $getObjectMocks],
	): AWS.S3.Types.GetObjectOutput => {
		return {
			...getObjectMock,

			Body:
				'Body' in getObjectMock && getObjectMock.Body
					? Buffer.from(getObjectMock.Body)
					: undefined,
			LastModified:
				'LastModified' in getObjectMock && getObjectMock.LastModified
					? new Date(getObjectMock.LastModified)
					: undefined,
		};
	},
);

class NotFoundError extends Error {
	statusCode = 404;

	constructor() {
		super('NotFound');
	}
}

const toReturnType = <T extends (...args: any[]) => any>(result: {
	[key: string]: any;
}) => {
	return ({
		promise: () => {
			if (result.Error) {
				const error = new Error();
				Object.assign(error, result.Error);

				return Promise.reject(error);
			}
			return Promise.resolve(result);
		},
	} as unknown) as ReturnType<T>;
};

type UnauthenticatedRequestParams = { [key: string]: any };

class S3Mock {
	makeUnauthenticatedRequest(
		operation: string,
		params?: UnauthenticatedRequestParams,
	): AWS.Request<any, AWS.AWSError> {
		if (operation === 'headObject') {
			return this.headObject(params as AWS.S3.Types.HeadObjectRequest);
		}
		if (operation === 'getObject') {
			return this.getObject(params as AWS.S3.Types.GetObjectRequest);
		}
		if (operation === 'listObjectsV2') {
			return this.listObjectsV2(params as AWS.S3.Types.ListObjectsV2Request);
		}
		throw new Error(`AWS Mock: Operation ${operation} isn't implemented`);
	}

	headObject(
		params: AWS.S3.Types.HeadObjectRequest,
	): ReturnType<AWS.S3['headObject']> {
		const mock = getObjectMocks[params.Key as keyof typeof getObjectMocks];
		if (mock) {
			const trimmedMock = _.omit(mock, 'Body', 'ContentRange', 'TagCount');
			return toReturnType<AWS.S3['headObject']>(trimmedMock);
		}

		// treat not found IGNORE file mocks as 404
		if (_.endsWith(params.Key, '/IGNORE')) {
			return toReturnType<AWS.S3['headObject']>(
				Promise.reject(new NotFoundError()),
			);
		}

		throw new Error(
			`aws mock: headObject could not find a mock for ${params.Key}`,
		);
	}

	getObject(
		params: AWS.S3.Types.GetObjectRequest,
	): ReturnType<AWS.S3['getObject']> {
		const mock = getObjectMocks[params.Key as keyof typeof getObjectMocks];
		if (!mock) {
			throw new Error(
				`aws mock: getObject could not find a mock for ${params.Key}`,
			);
		}
		return toReturnType<AWS.S3['getObject']>(mock);
	}

	listObjectsV2(
		params: AWS.S3.Types.ListObjectsV2Request,
	): ReturnType<AWS.S3['listObjectsV2']> {
		const mock =
			listObjectsV2Mocks[params.Prefix as keyof typeof listObjectsV2Mocks];
		if (!mock) {
			throw new Error(
				`aws mock: listObjectsV2 could not find a mock for ${params.Prefix}`,
			);
		}
		return toReturnType<AWS.S3['listObjectsV2']>(mock);
	}
}

export const AWSSdkMock = {
	S3: S3Mock,
};

mockery.enable({ warnOnUnregistered: false, warnOnReplace: true });
mockery.registerMock('aws-sdk', AWSSdkMock);
