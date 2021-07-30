import * as _ from 'lodash';
import * as semver from 'balena-semver';
import { sbvrUtils, dbModule } from '@balena/pinejs';

import {
	DEFAULT_SUPERVISOR_POLL_INTERVAL,
	DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS,
	METRICS_MAX_REPORT_INTERVAL_SECONDS,
} from '../../lib/config';
import { StatePatchV2Body } from './routes/state-patch-v2';
import { createMultiLevelStore } from '../../infra/cache';
import { StatePatchV3Body } from './routes/state-patch-v3';

// Set RESIN_SUPERVISOR_POLL_INTERVAL to a minimum of 10 minutes
export const setMinPollInterval = (config: AnyObject): void => {
	const pollInterval =
		config.RESIN_SUPERVISOR_POLL_INTERVAL == null
			? 0
			: parseInt(config.RESIN_SUPERVISOR_POLL_INTERVAL, 10);
	// Multicontainer supervisor requires the poll interval to be a string
	config.RESIN_SUPERVISOR_POLL_INTERVAL =
		'' + Math.max(pollInterval, DEFAULT_SUPERVISOR_POLL_INTERVAL);
};

export const getReleaseForDevice = (
	device: AnyObject,
): AnyObject | undefined => {
	if (device.should_be_running__release[0] != null) {
		return device.should_be_running__release[0];
	}
	return device.belongs_to__application[0]?.should_be_running__release[0];
};

export const serviceInstallFromImage = (
	device: AnyObject,
	image?: AnyObject,
): undefined | AnyObject => {
	if (image == null) {
		return;
	}

	let id: number;
	if (typeof image.is_a_build_of__service === 'object') {
		id = image.is_a_build_of__service.__id;
	} else {
		id = image.is_a_build_of__service;
	}

	return _.find(device.service_install, (si) => si.service[0].id === id);
};

export const formatImageLocation = (imageLocation: string) =>
	imageLocation.toLowerCase();

// Some config vars cause issues with certain versions of resinOS.
// This function will check the OS version against the config
// vars and filter any which cause problems, returning a new map to
// be sent to the device.
//
// `configVars` should be in the form { [name: string]: string }
export const filterDeviceConfig = (
	configVars: Dictionary<string>,
	osVersion: string,
): void => {
	// ResinOS >= 2.x has a read-only file system, and this var causes the
	// supervisor to run `systemctl enable|disable [unit]`, which does not
	// persist over reboots. This causes the supervisor to go into a reboot
	// loop, so filter out this var for these os versions.
	if (semver.gte(osVersion, '2.0.0')) {
		delete configVars.RESIN_HOST_LOG_TO_DISPLAY;
	}
};

export const v3ValidPatchFields: Array<
	Exclude<keyof StatePatchV3Body[string], 'apps'>
> = [
	'is_managed_by__device',
	'status',
	'is_online',
	'os_version',
	'os_variant',
	'supervisor_version',
	'provisioning_progress',
	'provisioning_state',
	'ip_address',
	'mac_address',
	'api_port',
	'api_secret',
	'logs_channel',
	'cpu_id',
	'is_undervolted',
];

export const v2ValidPatchFields: Array<
	Exclude<keyof NonNullable<StatePatchV2Body['local']>, 'apps'>
> = [
	...v3ValidPatchFields,
	'should_be_running__release',
	'device_name',
	'note',
	'download_progress',
];

export const metricsPatchFields = [
	'memory_usage',
	'memory_total',
	'storage_block_device',
	'storage_usage',
	'storage_total',
	'cpu_temp',
	'cpu_usage',
] as const;

let $readTransaction: dbModule.Database['readTransaction'] = (
	...args: Parameters<dbModule.Database['readTransaction']>
) => sbvrUtils.db.readTransaction!(...args);
export const setReadTransaction = (
	newReadTransaction: dbModule.Database['readTransaction'],
) => {
	$readTransaction = newReadTransaction;
};
export const readTransaction: dbModule.Database['readTransaction'] = (
	...args: Parameters<dbModule.Database['readTransaction']>
) => $readTransaction(...args);

export const rejectUiConfig = (name: string) =>
	!/^(BALENA|RESIN)_UI/.test(name);

export type EnvVarList = Array<{ name: string; value: string }>;
export const varListInsert = (
	varList: EnvVarList,
	obj: Dictionary<string>,
	filterFn: (name: string) => boolean = () => true,
) => {
	varList.forEach(({ name, value }) => {
		if (filterFn(name)) {
			obj[name] = value;
		}
	});
};

// These 2 config vars below are mapped to labels if missing for backwards-compatibility
// See: https://github.com/resin-io/hq/issues/1340
export const ConfigurationVarsToLabels = {
	RESIN_SUPERVISOR_UPDATE_STRATEGY: 'io.resin.update.strategy',
	RESIN_SUPERVISOR_HANDOVER_TIMEOUT: 'io.resin.update.handover-timeout',
};

export const shouldUpdateMetrics = (() => {
	const lastMetricsReportTime = createMultiLevelStore<number>(
		'lastMetricsReportTime',
		{
			ttl: METRICS_MAX_REPORT_INTERVAL_SECONDS,
		},
		false,
	);
	const METRICS_MAX_REPORT_INTERVAL =
		METRICS_MAX_REPORT_INTERVAL_SECONDS * 1000;
	return async (uuid: string) => {
		const lastMetricsUpdate = await lastMetricsReportTime.get(uuid);
		const now = Date.now();
		// If the entry has expired then it means we should actually do the report
		if (
			lastMetricsUpdate == null ||
			lastMetricsUpdate + METRICS_MAX_REPORT_INTERVAL < now
		) {
			// And we add a new entry
			await lastMetricsReportTime.set(uuid, now);
			return true;
		}
		return false;
	};
})();

export type ImageInstallUpdateBody = {
	status: string;
	is_provided_by__release: number;
	download_progress?: number;
};
export const shouldUpdateImageInstall = (() => {
	const lastImageInstallReport = createMultiLevelStore<
		ImageInstallUpdateBody & { updateTime: number }
	>(
		'lastImageInstallUpdate',
		{
			ttl: DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS,
		},
		false,
	);
	const DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL =
		DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS * 1000;
	return async (imageInstallId: number, body: ImageInstallUpdateBody) => {
		const key = `${imageInstallId}`;
		const lastReport = await lastImageInstallReport.get(key);
		const now = Date.now();
		if (
			lastReport == null ||
			// If the entry has expired then it means we should actually do the report
			lastReport.updateTime + DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL < now ||
			// Or if the status has changed
			lastReport.status !== body.status ||
			// Or if the release has changed
			lastReport.is_provided_by__release !== body.is_provided_by__release ||
			// Or if the download progress has hit a milestone...
			// From not downloading to downloading
			(lastReport.download_progress == null &&
				body.download_progress != null) ||
			// From downloading to not downloading
			(lastReport.download_progress != null &&
				body.download_progress == null) ||
			// Hits 100%
			body.download_progress === 100
		) {
			// And we add a new entry
			await lastImageInstallReport.set(key, {
				// Keep the last reported download progress if the current report doesn't include it
				download_progress: lastReport?.download_progress,
				...body,
				updateTime: now,
			});
			return true;
		}
		return false;
	};
})();
