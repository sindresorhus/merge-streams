import {once, defaultMaxListeners} from 'node:events';
import {createReadStream} from 'node:fs';
import {writeFile, rm} from 'node:fs/promises';
import {Readable, PassThrough, getDefaultHighWaterMark} from 'node:stream';
import {text} from 'node:stream/consumers';
import {scheduler} from 'node:timers/promises';
import test from 'ava';
import tempfile from 'tempfile';
import mergeStreams from './index.js';

const getInfiniteStream = () => new Readable({read() {}});

test('works with Readable.from()', async t => {
	const stream = mergeStreams([
		Readable.from(['a', 'b']),
		Readable.from(['c', 'd']),
	]);

	const result = await stream.toArray();
	t.deepEqual(result.sort(), ['a', 'b', 'c', 'd'].sort());
});

const bigContents = '.'.repeat(1e6);

test('works with fs.createReadStream()', async t => {
	const files = [tempfile(), tempfile()];
	await Promise.all(files.map(file => writeFile(file, bigContents)));

	const stream = mergeStreams(files.map(file => createReadStream(file, 'utf8')));

	t.is(await text(stream), `${bigContents}${bigContents}`);

	await Promise.all(files.map(file => rm(file)));
});

const largeValue = '.'.repeat(1e7);
const largeRepeat = 20;

test('Handles large values', async t => {
	const stream = mergeStreams([Readable.from(Array.from({length: largeRepeat}).fill(largeValue))]);
	t.is(await text(stream), largeValue.repeat(largeRepeat));
});

test('propagate stream errors', async t => {
	const inputStream = getInfiniteStream();
	const stream = mergeStreams([inputStream]);
	const error = new Error('test');
	inputStream.destroy(error);
	const [destinationError] = await once(stream, 'error');
	t.is(destinationError, error);
	t.false(stream.readableEnded);
	t.is(stream.errored, error);
	t.true(stream.readableAborted);
	t.true(stream.closed);
	t.true(stream.destroyed);
});

test('propagate stream aborts', async t => {
	const inputStream = getInfiniteStream();
	const stream = mergeStreams([inputStream]);
	inputStream.destroy();
	await once(stream, 'close');
	t.false(stream.readableEnded);
	t.is(stream.errored, null);
	t.true(stream.readableAborted);
	t.true(stream.closed);
	t.true(stream.destroyed);
});

test('handles no input', async t => {
	const stream = mergeStreams([]);
	t.deepEqual(await stream.toArray(), []);
});

test('validates argument is an array', t => {
	t.throws(() => {
		mergeStreams(Readable.from([]));
	}, {message: /Expected an array/});
});

test('validates arguments are streams', t => {
	t.throws(() => {
		mergeStreams([false]);
	}, {message: /Expected a readable stream/});
});

const testObjectMode = async (t, firstObjectMode, secondObjectMode, mergeObjectMode) => {
	const stream = mergeStreams([
		Readable.from(['a'], {objectMode: firstObjectMode}),
		Readable.from(['b'], {objectMode: secondObjectMode}),
	]);
	t.is(stream.readableObjectMode, mergeObjectMode);
	await stream.toArray();
};

test('is not in objectMode if no input stream is', testObjectMode, false, false, false);
test('is in objectMode if only some input streams are', testObjectMode, false, true, true);
test('is in objectMode if all input streams are', testObjectMode, true, true, true);

test('Can end the merge stream before the input streams', async t => {
	const stream = mergeStreams([Readable.from('.')]);
	stream.end();
	t.deepEqual(await stream.toArray(), []);
});

test('Can abort the merge stream before the input streams', async t => {
	const stream = mergeStreams([Readable.from('.')]);
	stream.destroy();
	await t.throwsAsync(stream.toArray(), {code: 'ERR_STREAM_PREMATURE_CLOSE'});
});

test('Can destroy the merge stream before the input streams', async t => {
	const stream = mergeStreams([Readable.from('.')]);
	const error = new Error('test');
	stream.destroy(error);
	t.is(await t.throwsAsync(stream.toArray()), error);
});

const testListenersCleanup = (t, inputStream, stream) => {
	t.is(inputStream.listeners().length, 0);
	t.is(stream.listeners().length, 0);
};

test('Cleans up input streams listeners on all input streams end', async t => {
	const inputStream = Readable.from(['.']);
	const stream = mergeStreams([inputStream, Readable.from(['.'])]);
	t.is(await text(stream), '..');
	testListenersCleanup(t, inputStream, stream);
});

test('Cleans up input streams listeners on any input streams abort', async t => {
	const inputStream = Readable.from(['.']);
	const stream = mergeStreams([inputStream, Readable.from(['.'])]);
	inputStream.destroy();
	await t.throwsAsync(stream.toArray(), {code: 'ERR_STREAM_PREMATURE_CLOSE'});
	testListenersCleanup(t, inputStream, stream);
});

test('Cleans up input streams listeners on any input streams error', async t => {
	const inputStream = Readable.from(['.']);
	const stream = mergeStreams([inputStream, Readable.from(['.'])]);
	const error = new Error('test');
	inputStream.destroy(error);
	t.is(await t.throwsAsync(stream.toArray()), error);
	testListenersCleanup(t, inputStream, stream);
});

test('Cleans up input streams listeners on merged stream end', async t => {
	const inputStream = getInfiniteStream();
	const stream = mergeStreams([inputStream]);
	stream.end();
	await stream.toArray();
	await scheduler.yield();
	testListenersCleanup(t, inputStream, stream);
});

test('Cleans up input streams listeners on merged stream abort', async t => {
	const inputStream = getInfiniteStream();
	const stream = mergeStreams([inputStream]);
	stream.destroy();
	await t.throwsAsync(stream.toArray(), {code: 'ERR_STREAM_PREMATURE_CLOSE'});
	testListenersCleanup(t, inputStream, stream);
});

test('Cleans up input streams listeners on merged stream error', async t => {
	const inputStream = getInfiniteStream();
	const stream = mergeStreams([inputStream]);
	const error = new Error('test');
	stream.destroy(error);
	t.is(await t.throwsAsync(stream.toArray()), error);
	testListenersCleanup(t, inputStream, stream);
});

test('The input streams might have already ended', async t => {
	const inputStream = Readable.from(['.']);
	await inputStream.toArray();
	const stream = mergeStreams([inputStream]);
	t.deepEqual(await stream.toArray(), []);
});

test('The input streams might have already aborted', async t => {
	const inputStream = Readable.from(['.']);
	inputStream.destroy();
	const stream = mergeStreams([inputStream]);
	await t.throwsAsync(stream.toArray(), {code: 'ERR_STREAM_PREMATURE_CLOSE'});
});

test('The input streams might have already errored', async t => {
	const inputStream = Readable.from(['.']);
	const error = new Error('test');
	inputStream.destroy(error);
	const stream = mergeStreams([inputStream]);
	t.is(await t.throwsAsync(stream.toArray()), error);
});

const testHighWaterMarkAmount = async (t, firstObjectMode, secondObjectMode, highWaterMark) => {
	const stream = mergeStreams([
		Readable.from(['a', 'b'], {highWaterMark: 4, objectMode: firstObjectMode}),
		Readable.from(['c', 'd'], {highWaterMark: 2, objectMode: secondObjectMode}),
	]);
	t.is(stream.readableHighWaterMark, highWaterMark);
	t.is(stream.writableHighWaterMark, highWaterMark);
	await stream.toArray();
};

test('highWaterMark is the maximum of non-object input streams', testHighWaterMarkAmount, false, false, 4);
test('highWaterMark is the maximum of object input streams', testHighWaterMarkAmount, true, true, 4);
test('highWaterMark is the maximum of object streams if mixed with non-object ones', testHighWaterMarkAmount, false, true, 2);

const testBufferSize = async (t, objectMode) => {
	const highWaterMark = getDefaultHighWaterMark(objectMode);
	const oneStream = new PassThrough({highWaterMark, objectMode});
	const twoStream = new PassThrough({highWaterMark, objectMode});
	const stream = mergeStreams([oneStream, twoStream]);

	// Each PassThrough has a read + write buffer, including the merged stream
	// Therefore, there are 6 buffers of size `highWaterMark`
	const bufferCount = 6;

	let writeCount = 0;
	while (oneStream.write('.') && twoStream.write('.')) {
		writeCount += 2;
		// eslint-disable-next-line no-await-in-loop
		await scheduler.yield();
	}

	// Ensure the maximum amount buffered on writes are those 5 buffers
	t.is(writeCount - 2, (highWaterMark - 1) * bufferCount);

	let readCount = 0;
	while (stream.read() !== null) {
		readCount += 1;
		// eslint-disable-next-line no-await-in-loop
		await scheduler.yield();
	}

	// When not in object mode, each read retrieves a full buffer, i.e. there are 5 reads
	// When in object mode, each read retrieves a single value, i.e. there are as many reads as writes
	t.is(readCount, objectMode ? writeCount + 1 : bufferCount);

	t.pass();
};

test('Use the correct highWaterMark', testBufferSize, false);
test('Use the correct highWaterMark, objectMode', testBufferSize, true);

test('Buffers streams before consumption', async t => {
	const inputStream = Readable.from(['.']);
	const stream = mergeStreams([inputStream]);
	await scheduler.yield();

	t.is(inputStream.readableLength, 0);
	t.false(inputStream.readableFlowing);
	t.true(inputStream.destroyed);

	t.is(stream.readableLength, 1);
	t.is(stream.readableFlowing, null);
	t.false(stream.destroyed);
	t.is(await text(stream), '.');
});

const assertMaxListeners = (t, stream, remainingListeners) => {
	const listenersMaxCount = Math.max(...stream.eventNames().map(eventName => stream.listenerCount(eventName)));
	t.is(stream.getMaxListeners() - listenersMaxCount, remainingListeners);
};

test('Does not increment maxListeners of merged streams', async t => {
	const length = 1e3;
	const inputStreams = Array.from({length}, () => Readable.from(['.']));
	const stream = mergeStreams(inputStreams);
	assertMaxListeners(t, stream, defaultMaxListeners);
	await stream.toArray();
});

test('Only increments maxListeners of input streams by 2', async t => {
	const inputStream = Readable.from(['.']);
	inputStream.setMaxListeners(2);
	const stream = mergeStreams([inputStream]);
	assertMaxListeners(t, inputStream, 0);
	await stream.toArray();
	t.pass();
});
