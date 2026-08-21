import { parentPort, workerData } from 'worker_threads';
import { parseLogFile } from './index';
import { SqlRecord } from '../types/sql';
import { AppLogRecord } from '../types/log';
import { LogTraceStub } from '../types/stub';

if (parentPort && workerData) {
  (async () => {
    const { files, hasAppLogCallback } = workerData as { files: string[]; hasAppLogCallback: boolean };
    let workerBatch: SqlRecord[] = [];
    const WORKER_BATCH_SIZE = 10000;

    let workerAppLogBatch: AppLogRecord[] = [];
    const WORKER_APP_LOG_BATCH_SIZE = 5000;

    let workerStubs: LogTraceStub[] = [];
    let totalWorkerLines = 0;

    for (const file of files) {
      const result = await parseLogFile(
        file,
        record => {
          workerBatch.push(record);
          if (workerBatch.length >= WORKER_BATCH_SIZE) {
            parentPort!.postMessage({ type: 'batch', records: workerBatch });
            workerBatch = [];
          }
        },
        0,
        perfData => {
          parentPort!.postMessage({ type: 'perf_trace', data: perfData });
        },
        hasAppLogCallback
          ? appLog => {
              workerAppLogBatch.push(appLog);
              if (workerAppLogBatch.length >= WORKER_APP_LOG_BATCH_SIZE) {
                parentPort!.postMessage({ type: 'app_log_batch', records: workerAppLogBatch });
                workerAppLogBatch = [];
              }
            }
          : null,
        0,
        stub => {
          workerStubs.push(stub);
        }
      );
      totalWorkerLines += result.totalLines;
    }

    if (workerBatch.length > 0) {
      parentPort!.postMessage({ type: 'batch', records: workerBatch });
    }
    if (workerAppLogBatch.length > 0) {
      parentPort!.postMessage({ type: 'app_log_batch', records: workerAppLogBatch });
    }
    if (workerStubs.length > 0) {
      parentPort!.postMessage({ type: 'trace_stubs', stubs: workerStubs });
    }

    parentPort!.postMessage({ type: 'done', totalLines: totalWorkerLines });
  })().catch(err => {
    console.error('Worker error:', err);
    process.exit(1);
  });
}
