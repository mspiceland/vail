// decoder.mjs

// State to accumulate Morse code message data
let accumulatedDurations = [];
let lastTimestamp = 0;
let characterTimeoutHandle = null;
let wordTimeoutHandle = null;
let wpm = 15; // Assume initial speed of 15 words per minute
const CHARACTER_TIMEOUT = 3; // Timeout in units to determine character boundary
const WORD_TIMEOUT = 7; // Timeout in units to determine word boundary
let decodedString = "";

// Circular buffer to track recent durations for WPM calculation
const bufferSize = 12;
let durationBuffer = new Array(bufferSize).fill(0);
let bufferIndex = 0;

// Helper function to decode Morse code based on the timing rules
export function decodeMorse(durations, unitTime) {
    const DIT_UNIT = unitTime;
    const DAH_UNIT = DIT_UNIT * 3;

    let morseSymbols = "";
    for (let i = 0; i < durations.length; i++) {
        const duration = durations[i];

        if (duration < DIT_UNIT * 1.5) {
            morseSymbols += "."; // dit
        } else if (duration < DAH_UNIT * 1.5) {
            morseSymbols += "-"; // dah
        }
    }

    return morseSymbols;
}

// Helper function to translate Morse code symbols into text
export function morseToText(morseCode) {
    const MORSE_DICT = {
        ".-": "A",
        "-...": "B",
        "-.-.": "C",
        "-..": "D",
        ".": "E",
        "..-.": "F",
        "--.": "G",
        "....": "H",
        "..": "I",
        ".---": "J",
        "-.-": "K",
        ".-..": "L",
        "--": "M",
        "-.": "N",
        "---": "O",
        ".--.": "P",
        "--.-": "Q",
        ".-.": "R",
        "...": "S",
        "-": "T",
        "..-": "U",
        "...-": "V",
        ".--": "W",
        "-..-": "X",
        "-.--": "Y",
        "--..": "Z",
        "-----": "0",
        ".----": "1",
        "..---": "2",
        "...--": "3",
        "....-": "4",
        ".....": "5",
        "-....": "6",
        "--...": "7",
        "---..": "8",
        "----.": "9",
        ".-.-.-": ".",
        "--..--": ",",
        "..--..": "?",
        "/": " ",
    };

    return morseCode
        .split(" ")
        .map(symbol => MORSE_DICT[symbol] || "*")
        .join("");
}

// Helper function to calculate WPM from recent durations
export function calculateWPM() {
    // Filter out zero durations
    const validDurations = durationBuffer.filter(duration => duration > 0);
    if (validDurations.length === 0) {
        return wpm; // Return the current WPM if no valid durations
    }

    // Find the shortest duration as the estimated dit length
    const ditLength = Math.min(...validDurations);

    // Calculate WPM from dit length
    const newWpm = Math.round(1200 / ditLength);
    return newWpm;
}

export function updateDurations(duration, timestamp) {
    if (characterTimeoutHandle) {
        clearTimeout(characterTimeoutHandle);
    }

    accumulatedDurations.push(duration);
    lastTimestamp = timestamp;

    // Update circular buffer and calculate WPM
    durationBuffer[bufferIndex] = duration;
    bufferIndex = (bufferIndex + 1) % bufferSize;
    wpm = calculateWPM();

    return wpm;
}

export function clearAccumulatedDurations() {
    accumulatedDurations = [];
    lastTimestamp = 0;
}

export function getAccumulatedDurations() {
    return accumulatedDurations;
}

export function getWpm() {
    return wpm;
} 

export function getDecodedString() {
    return decodedString;
}

export function appendToDecodedString(text) {
    decodedString += text;
}
