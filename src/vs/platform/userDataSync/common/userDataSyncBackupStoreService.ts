/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, } from 'vs/base/common/lifecycle';
import { IUserDataSyncLogService, ResourceKey, ALL_RESOURCE_KEYS, IUserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSync';
import { joinPath } from 'vs/base/common/resources';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { toLocalISOString } from 'vs/base/common/date';
import { VSBuffer } from 'vs/base/common/buffer';

export class UserDataSyncBackupStoreService extends Disposable implements IUserDataSyncBackupStoreService {

	_serviceBrand: any;

	constructor(
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IUserDataSyncLogService private readonly logService: IUserDataSyncLogService,
	) {
		super();
		ALL_RESOURCE_KEYS.forEach(resourceKey => this.cleanUpBackup(resourceKey));
	}

	async backup(resourceKey: ResourceKey, content: string): Promise<void> {
		const folder = joinPath(this.environmentService.userDataSyncHome, resourceKey);
		const resource = joinPath(folder, `${toLocalISOString(new Date()).replace(/-|:|\.\d+Z$/g, '')}.json`);
		try {
			await this.fileService.writeFile(resource, VSBuffer.fromString(content));
		} catch (e) {
			this.logService.error(e);
		}
		try {
			this.cleanUpBackup(resourceKey);
		} catch (e) { /* Ignore */ }
	}

	private async cleanUpBackup(resourceKey: ResourceKey): Promise<void> {
		const folder = joinPath(this.environmentService.userDataSyncHome, resourceKey);
		try {
			try {
				if (!(await this.fileService.exists(folder))) {
					return;
				}
			} catch (e) {
				return;
			}
			const stat = await this.fileService.resolve(folder);
			if (stat.children) {
				const all = stat.children.filter(stat => stat.isFile && /^\d{8}T\d{6}(\.json)?$/.test(stat.name)).sort();
				const backUpMaxAge = 1000 * 60 * 60 * 24 * (this.configurationService.getValue<number>('sync.localBackupDuration') || 30 /* Default 30 days */);
				let toDelete = all.filter(stat => {
					const ctime = stat.ctime || new Date(
						parseInt(stat.name.substring(0, 4)),
						parseInt(stat.name.substring(4, 6)) - 1,
						parseInt(stat.name.substring(6, 8)),
						parseInt(stat.name.substring(9, 11)),
						parseInt(stat.name.substring(11, 13)),
						parseInt(stat.name.substring(13, 15))
					).getTime();
					return Date.now() - ctime > backUpMaxAge;
				});
				const remaining = all.length - toDelete.length;
				if (remaining < 10) {
					toDelete = toDelete.slice(10 - remaining);
				}
				await Promise.all(toDelete.map(stat => {
					this.logService.info('Deleting from backup', stat.resource.path);
					this.fileService.del(stat.resource);
				}));
			}
		} catch (e) {
			this.logService.error(e);
		}
	}
}
