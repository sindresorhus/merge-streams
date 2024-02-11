import {Readable} from 'node:stream';
import {expectType, expectError, expectAssignable} from 'tsd';
import mergeStreams from './index.js';

const readableStream = Readable.from('.');

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

expectType<void>(mergedStream.remove(readableStream));
expectError(mergedStream.remove());
expectError(mergedStream.remove([]));
expectError(mergedStream.remove(''));

