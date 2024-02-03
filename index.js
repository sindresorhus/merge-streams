import {setMaxListeners, on, once} from 'node:events';
import {PassThrough as PassThroughStream} from 'node:stream';
import {finished} from 'node:stream/promises';

export default function mergeStreams(streams) {
	if (!Array.isArray(streams)) {
		throw new TypeError(`Expected an array, got \`${typeof streams}\`.`);
	}

	const invalidStream = streams.find(stream => typeof stream?.pipe !== 'function');
	if (invalidStream !== undefined) {
		throw new TypeError(`Expected a readable stream, got: \`${typeof invalidStream}\`.`);
	}

	const objectMode = streams.some(({readableObjectMode}) => readableObjectMode);
	const highWaterMark = getHighWaterMark(streams, objectMode);
	const passThroughStream = new PassThroughStream({objectMode, writableHighWaterMark: highWaterMark, readableHighWaterMark: highWaterMark});

	if (streams.length === 0) {
		passThroughStream.end();
		return passThroughStream;
	}

	passThroughStream.setMaxListeners(passThroughStream.getMaxListeners() + getPassThroughListenersCount(streams));

	for (const stream of streams) {
		stream.pipe(passThroughStream, {end: false});
	}

	endWhenStreamsDone(passThroughStream, streams);

	return passThroughStream;
}

const getHighWaterMark = (streams, objectMode) => {
	if (streams.length === 0) {
		return 0;
	}

	const highWaterMarks = streams
		.filter(({readableObjectMode}) => readableObjectMode === objectMode)
		.map(({readableHighWaterMark}) => readableHighWaterMark);
	return Math.max(...highWaterMarks);
};

// Number of times `passThroughStream.on()` is called:
//  - once per stream due to `stream.pipe(passThroughStream)`
//  - once due to `finished(passThroughStream)`
//  - once due to `on(passThroughStream)`
const getPassThroughListenersCount = streams => streams.length + 2;

const endWhenStreamsDone = async (passThroughStream, streams) => {
	try {
		const abortController = new AbortController();
		setMaxListeners(getSignalListenersCount(streams), abortController.signal);
		try {
			await Promise.race([
				onMergedStreamEnd(passThroughStream, abortController),
				onInputStreamsUnpipe(streams, passThroughStream, abortController),
				onInputStreamsEnd(streams, passThroughStream, abortController),
			]);
		} finally {
			abortController.abort();
		}
	} catch (error) {
		// This is the error thrown by `finished()` on `stream.destroy()`
		if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
			passThroughStream.destroy();
		} else {
			passThroughStream.destroy(error);
		}
	}
};

// Number of times `abortController.signal.on('abort')` is called. `signal` is used by:
//  - each stream with both `finished()` and `once()`
//  - `passThroughStream()` with both `finished()` and `on()`
const getSignalListenersCount = streams => (streams.length * 2) + 2;

const onMergedStreamEnd = async (passThroughStream, {signal}) => {
	try {
		await finished(passThroughStream, {signal, cleanup: true});
	} catch {}
};

const onInputStreamsUnpipe = async (streams, passThroughStream, {signal}) => {
	const streamsSet = new Set(streams);
	for await (const [stream] of on(passThroughStream, 'unpipe', {signal})) {
		if (streamsSet.has(stream)) {
			stream.emit(unpipeEvent);
		}
	}
};

const onInputStreamsEnd = async (streams, passThroughStream, {signal}) => {
	await Promise.all(streams.map(stream => onInputStreamEnd(stream, signal)));
	passThroughStream.end();
};

const onInputStreamEnd = async (stream, signal) => {
	await Promise.race([
		finished(stream, {signal, cleanup: true, readable: true, writable: false}),
		once(stream, unpipeEvent, {signal}),
	]);
};

const unpipeEvent = Symbol('unpipe');
