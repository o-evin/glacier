import path from 'path';
import {isFunction} from 'lodash';

import {glacier} from '../api';

import Queue from './queue';
import Uploader from './uploader';
import Receiver from './receiver';
import Inventorizer from './inventorizer';

import logger from '../../utils/logger';
const debug = logger('executor:main');

export default class JobExecutor {

  constructor() {
    this.queue = new Queue();
    this.uploader = new Uploader();
    this.receiver = new Receiver();
    this.inventorizer = new Inventorizer();
  }

  removeVault(vaultName) {
    return Promise.all([
      this.uploader.removeAll({vaultName}),
      this.receiver.removeAll({vaultName}),
      this.inventorizer.removeAll({vaultName}),
    ]).then(() => {
      return this.queue.push(
        glacier.deleteVault.bind(null, vaultName)
      );
    });
  }

  requestInventory(vaultName) {
    debug('INITIATE INVENTORY', vaultName);
    return this.inventorizer.requestInventory(vaultName);
  }

  cancelInventory(retrieval) {
    debug('CANCEL INVENTORY', retrieval.vaultName);
    return this.inventorizer.cancel(retrieval);
  }

  removeArchive(archive) {
    debug('REMOVE ARCHIVE', archive.description);
    return this.inventorizer.removeArchive(archive);
  }

  requestUpload(params) {
    debug('INITIATE UPLOAD %s to %s',
      path.basename(params.filePath), params.vaultName
    );

    return this.queue.push(
      glacier.initiateUpload.bind(null, params)
    )
      .then((upload) => {
        return this.uploader.push(upload);
      });

  }

  removeUpload(upload) {
    debug('REMOVE UPLOAD', upload.description);

    return this.uploader.remove(upload)
      .then(() => {
        if(upload.archiveId) {
          var handler = glacier.deleteArchive.bind(null,
            upload.archiveId, upload.vaultName
          );
        } else {
          handler = glacier.abortUpload.bind(null, upload);
        }

        return this.queue.push(handler, {reference: upload.id});
      });
  }

  restartUpload(upload) {
    debug('RESTART UPLOAD', upload.description);
    return this.uploader.restart(upload);
  }

  requestRetrieval({archive, tier}) {
    debug('INITIATE RETRIEVAL %s from %s',
      archive.description, archive.vaultName
    );

    const {partSizeInBytes, downloadsPath} = global.config.get('transfer');

    const filePath = path.join(downloadsPath, archive.description);

    const params = {
      filePath,
      tier: tier,
      archiveId: archive.id,
      vaultName: archive.vaultName,
      partSize: partSizeInBytes,
      archiveSize: archive.size,
      checksum: archive.checksum,
      description: archive.description,
    };

    return this.queue.push(
      glacier.initiateRetrieval.bind(null, params)
    )
      .then((retrieval) => {
        return this.receiver.push(retrieval);
      });
  }

  removeRetrieval(retrieval) {
    debug('REMOVE RETRIEVAL', retrieval.description);
    return this.receiver.remove(retrieval);
  }

  restartRetrieval(retrieval) {
    debug('RESTART RETRIEVAL', retrieval.description);
    return this.receiver.restart(retrieval);
  }

  subscribe(listener) {
    if(!isFunction(listener)) {
      throw new Error('Listener must be a function.');
    }

    const unsubscribe = [
      this.uploader.subscribe(listener),
      this.receiver.subscribe(listener),
      this.inventorizer.subscribe(listener),
    ];

    return () => unsubscribe.forEach(unsubscribe => unsubscribe());
  }

  start() {
    return Promise.all([
      this.queue.start(),
      this.uploader.start(),
      this.receiver.start(),
      this.inventorizer.start(),
    ]);
  }

  stop() {
    return Promise.all([
      this.queue.stop(),
      this.uploader.stop(),
      this.receiver.stop(),
      this.inventorizer.stop(),
    ]);
  }

  isProcessing() {
    return this.queue.isProcessing() ||
      this.uploader.isProcessing() ||
      this.receiver.isProcessing();
  }

}
