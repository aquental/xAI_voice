// AudioWorkletProcessor that forwards mono signed 16-bit little-endian PCM
// frames from the microphone to the main thread via postMessage.
// (xAI STT defaults to encoding=pcm which is signed 16-bit LE.)
class PCMProcessor extends AudioWorkletProcessor {
	process(inputs) {
		const input = inputs[0];
		if (input && input[0]) {
			const f32 = input[0];
			const i16 = new Int16Array(f32.length);
			for (let i = 0; i < f32.length; i++) {
				const s = Math.max(-1, Math.min(1, f32[i]));
				i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
			}
			this.port.postMessage(i16.buffer, [i16.buffer]);
		}
		return true;
	}
}

registerProcessor('pcm-processor', PCMProcessor);
