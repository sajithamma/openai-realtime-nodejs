import Speaker from 'speaker'; // Import the speaker module to play audio
import fs from 'fs';
import WebSocket from "ws";
import decodeAudio from 'audio-decode';
import dotenv from 'dotenv';
dotenv.config();

let totalPcmDataLength = 0; // Track total PCM data length
const sampleRate = 24000; // Sample rate for WAV file
const numChannels = 1; // Mono audio

// Configure the speaker for 16-bit PCM audio at 24kHz
const speaker = new Speaker({
    channels: numChannels,          // 1 channel (mono)
    bitDepth: 16,                   // 16-bit samples
    sampleRate: sampleRate          // 24,000 Hz sample rate
});

// Function to append base64 PCM16 data to the speaker for real-time playback
function appendBase64AudioToSpeaker(base64Audio) {
    const pcmData = Buffer.from(base64Audio, 'base64');
    totalPcmDataLength += pcmData.length;

    // Write the PCM data to the speaker for real-time playback
    speaker.write(pcmData);
}

// Converts Float32Array of audio data to PCM16 ArrayBuffer
function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
}

// Converts a Float32Array to base64-encoded PCM16 data
function base64EncodeAudio(float32Array) {
    const arrayBuffer = floatTo16BitPCM(float32Array);
    let binary = '';
    let bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000; // 32KB chunk size
    for (let i = 0; i < bytes.length; i += chunkSize) {
        let chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return Buffer.from(binary, 'binary').toString('base64');
}

// WebSocket connection to OpenAI's API
const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
const openaiApiKey = process.env.OPENAI_API_KEY;

const ws = new WebSocket(url, {
    headers: {
        "Authorization": "Bearer " + openaiApiKey,  // Use your OpenAI API key here
        "OpenAI-Beta": "realtime=v1",
    },
});

ws.on("open", async function open() {
    console.log("Connected to server.");

    // Read and encode the input audio
    const myAudio = fs.readFileSync('gettysburg.wav');  // Replace with the path to your audio file
    const audioBuffer = await decodeAudio(myAudio);
    const channelData = audioBuffer.getChannelData(0); // only accepts mono
    const base64AudioData = base64EncodeAudio(channelData);

    // Send the input audio as the initial message to the WebSocket server
    const event = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [
                {
                    type: 'input_audio',
                    audio: base64AudioData
                }
            ]
        }
    };

    // Send the input audio and instructions via WebSocket
    ws.send(JSON.stringify(event));
    ws.send(JSON.stringify({
        type: "response.create",
        response: {
            modalities: ['audio', 'text'],
            instructions: "Please assist the user, answer to the question they ask.",
        }
    }));
});

// WebSocket message handler
ws.on("message", function incoming(message) {
    const parsedMessage = JSON.parse(message.toString());
    console.log("Message received from server:", parsedMessage);

    // Handle audio delta events
    if (parsedMessage.type === 'response.audio.delta' && parsedMessage.delta) {
        const base64Audio = parsedMessage.delta;
        appendBase64AudioToSpeaker(base64Audio); // Play audio chunk in real-time
    }

    // Handle the response.audio.done event
    if (parsedMessage.type === 'response.audio.done') {
        console.log("Audio generation done.");
        speaker.end(); // End the speaker stream
    }

    // If the message contains content, print it in detail
    if (parsedMessage.item && parsedMessage.item.content) {
        console.log("Message content:", JSON.stringify(parsedMessage.item.content, null, 2));
    }
});

// Handle WebSocket close event
ws.on("close", () => {
    console.log("WebSocket connection closed.");
    speaker.end(); // Make sure to end the speaker stream
});
