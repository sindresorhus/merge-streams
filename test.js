import process from 'node:process';
import fs from 'node:fs';
import {Readable} from 'node:stream';
import test from 'ava';
import mergeStreams from './index.js';

test('works with Readable.from()', async t => {
	const stream = await mergeStreams([
		Readable.from(['a', 'b']),
		Readable.from(['c', 'd']),
	]);

	const result = await stream.toArray();

	t.deepEqual(result.sort(), ['a', 'b', 'c', 'd'].sort());
});

test('works with fs.createReadStream()', async t => {
	const stream = await mergeStreams([
		fs.createReadStream('fixture1', {encoding: 'utf8'}),
		fs.createReadStream('fixture2', {encoding: 'utf8'}),
	]);

	const result = await stream.toArray();

	t.deepEqual(result.sort(), ['1', '2']);
});

test('emits error events on stream errors', async t => {
	t.plan(1);

	const errorStream = new Readable({
		read() {
			process.nextTick(() => {
				this.emit('error', new Error('Fake error'));
			});
		},
	});

	const stream = mergeStreams([errorStream]);

	await new Promise(resolve => {
		stream.on('error', error => {
			t.is(error.message, 'Fake error');
			resolve();
		});
	});
});

test('handles no input', async t => {
	const result = await mergeStreams([]).toArray();
	t.deepEqual(result, []);
});
