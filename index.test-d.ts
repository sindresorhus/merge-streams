import {Readable} from 'node:stream';
import {expectType, expectError, expectAssignable} from 'tsd';
import mergeStreams, {type MergedStream} from './index.js';

const readableStream = Readable.from('.');

expectType<MergedStream>(mergeStreams([]));
expectAssignable<Readable>(mergeStreams([]));
expectAssignable<Readable>(mergeStreams([readableStream]));

expectError(mergeStreams());
expectError(mergeStreams(readableStream));
expectError(mergeStreams(['']));

const mergedStream = mergeStreams([]);
expectType<void>(mergedStream.add(readableStream));
expectError(mergedStream.add());
expectError(mergedStream.add([]));
expectError(mergedStream.add(''));

expectType<Promise<boolean>>(mergedStream.remove(readableStream));
expectError(await mergedStream.remove());
expectError(await mergedStream.remove([]));
expectError(await mergedStream.remove(''));
