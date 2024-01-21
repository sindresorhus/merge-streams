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
	const readableHighWaterMark = getReadableHighWaterMark(streams, objectMode);
	const passThroughStream = new PassThroughStream({objectMode, writableHighWaterMark: 0, readableHighWaterMark});
	passThroughStream.setMaxListeners(Number.POSITIVE_INFINITY);

	if (streams.length === 0) {
		passThroughStream.end();
		return passThroughStream;
	}

	for (const stream of streams) {
		stream.pipe(passThroughStream, {end: false});
	}

	endWhenStreamsDone(passThroughStream, streams);

	return passThroughStream;
}

const getReadableHighWaterMark = (streams, objectMode) => {
	if (streams.length === 0) {
		return 0;
	}

	const highWaterMarks = streams
		.filter(({readableObjectMode}) => readableObjectMode === objectMode)
		.map(({readableHighWaterMark}) => readableHighWaterMark);
	return Math.max(...highWaterMarks);
};

const endWhenStreamsDone = async (passThroughStream, streams) => {
	try {
		await Promise.all(streams.map(stream => finished(stream, {cleanup: true, readable: true, writable: false})));
		passThroughStream.end();
	} catch (error) {
		// This is the error thrown by `finished()` on `stream.destroy()`
		if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
			passThroughStream.destroy();
		} else {
			passThroughStream.destroy(error);
		}
	}
};
