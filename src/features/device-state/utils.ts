import * as _ from 'lodash';

import * as semver from 'balena-semver';

import { DEFAULT_SUPERVISOR_POLL_INTERVAL } from '../../lib/config';
import { LocalBody } from './routes/state-patch';

const defaultConfigVariableFns: Array<(config: Dictionary<string>) => void> = [
	function setMinPollInterval(config) {
		const pollInterval =
			config.RESIN_SUPERVISOR_POLL_INTERVAL == null
				? 0
				: parseInt(config.RESIN_SUPERVISOR_POLL_INTERVAL, 10);
		// Multicontainer supervisor requires the poll interval to be a string
		config.RESIN_SUPERVISOR_POLL_INTERVAL =
			'' + Math.max(pollInterval, DEFAULT_SUPERVISOR_POLL_INTERVAL);
	},
];
export const addDefaultConfigVariableFn = (
	fn: typeof defaultConfigVariableFns[number],
) => {
	defaultConfigVariableFns.push(fn);
};
export const setDefaultConfigVariables = (config: Dictionary<string>): void => {
	for (const fn of defaultConfigVariableFns) {
		fn(config);
	}
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

export const validPatchFields: Array<Exclude<keyof LocalBody, 'apps'>> = [
	'is_managed_by__device',
	'should_be_running__release',
	'device_name',
	'status',
	'is_online',
	'note',
	'os_version',
	'os_variant',
	'supervisor_version',
	'provisioning_progress',
	'provisioning_state',
	'ip_address',
	'mac_address',
	'download_progress',
	'api_port',
	'api_secret',
	'logs_channel',
	'cpu_id',
	'is_undervolted',
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
