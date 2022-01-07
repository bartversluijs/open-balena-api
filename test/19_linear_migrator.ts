import * as mockery from 'mockery';
import * as sinon from 'sinon';
import { expect, chai } from './test-lib/chai';
import * as fakeDevice from './test-lib/fake-device';
import { supertest, UserObjectParam } from './test-lib/supertest';
import { version } from './test-lib/versions';
import { pineTest } from './test-lib/pinetest';
import * as configMock from '../src/lib/config';
import * as stateMock from '../src/features/device-heartbeat';
import { waitFor } from './test-lib/common';
import * as fixtures from './test-lib/fixtures';
import { expectResourceToMatch } from './test-lib/api-helpers';
import { redis, redisRO } from '../src/infra/redis';
import { setTimeout } from 'timers/promises';
import * as path from 'path';
import { sbvrUtils } from '@balena/pinejs';

import * as fs from 'fs';

const DEVICE_COUNT = 1000;

describe('Linear Migrator', () => {
	let fx: fixtures.Fixtures;
	let admin: UserObjectParam;
	let applicationId: number;
	const device: fakeDevice.Device[] = [];
	let pineUser: typeof pineTest;
	const newFile = path.resolve(
		__dirname,
		'fixtures',
		'19-linear-migrator',
		'devices.json',
	);

	before(async function () {
		this.timeout(1000 * 60 * 5);
		fx = await fixtures.load('19-linear-migrator');

		admin = fx.users.admin;
		applicationId = fx.applications.app1.id;
		const deviceType = fx.applications.app1.device_type;

		pineUser = pineTest.clone({
			passthrough: { user: admin },
		});

		// we are using some fake device schema for testing.
		const createTable = `
		CREATE TABLE IF NOT EXISTS public.fake_device
		(
			"created at" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
			"modified at" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
			id integer NOT NULL DEFAULT nextval('device_id_seq'::regclass),
			uuid text COLLATE pg_catalog."default" NOT NULL,
			"device name" character varying(255) COLLATE pg_catalog."default",
			"application id" integer NOT NULL,
			"is online" integer NOT NULL DEFAULT 0,
			"ip address" character varying(255) COLLATE pg_catalog."default",
			"mac address" character varying(255) COLLATE pg_catalog."default"
		);
		`;

		await sbvrUtils.db.executeSql(createTable);

		// hardcoded sql creates the data on the db faster than the api
		// creating 10 Million fake entries into fake table
		const createTestData = `
		INSERT INTO public.fake_device (
			id,
			uuid,
			"device name",
			"application id",
			"is online",
			"ip address",
			"mac address"
		)
		SELECT 
			g.id, 
			g.id, 
			md5(RANDOM()::TEXT), 
			floor(random() * 100 + 1)::int,
			floor(random() + 0.5)::int,
			md5(RANDOM()::TEXT),
			md5(RANDOM()::TEXT)
		FROM generate_series(1, 10000000) AS g (id) ;

		`;
		sbvrUtils.db.executeSql(createTestData);

		const schemaMigration = `
			ALTER TABLE public.fake_device
			ADD COLUMN "application" integer
			`;

		sbvrUtils.db.executeSql(schemaMigration);

		// when this condition is 0 the migration has ended.
		const dataMigrationEndCondition = `
			SELECT id
			FROM public.fake_device
			WHERE application IS NULL
			LIMIT 1
		`;

		const dataMigration = `
		UPDATE public.fake_device
		SET application = "application id"
		WHERE id IN (SELECT id
					FROM public.fake_device
					WHERE application IS NULL
					LIMIT 10);
		`;

		while (
			(await sbvrUtils.db.executeSql(dataMigrationEndCondition))
				.rowsAffected !== 0
		) {
			sbvrUtils.db.executeSql(dataMigration);
		}
	});

	after(async () => {
		await fixtures.clean(fx);
		fs.rmSync(newFile);
	});

	describe('Check Data before migration', () => {
		it('Check device count', async () => {
			const result = await pineUser
				.get({
					resource: 'device',
					options: {
						$select: ['uuid', 'name'],
						$count: true,
					},
				})
				.expect(200);
			console.log(result);
		});
	});
});
