// jshint asi:true

const lowFreq = 660
const highFreq = lowFreq * 6 / 5 // Perfect minor third
const errorFreq = 30

const PAUSE = -1
const DIT = 1
const DAH = 3

// iOS kludge
if (!window.AudioContext) {
	window.AudioContext = window.webkitAudioContext
}

function toast(msg) {
	let el = document.querySelector("#snackbar")
	el.MaterialSnackbar.showSnackbar({
		message: msg,
		timeout: 2000
	})
}

/**
 * A callback to start or stop transmission
 * 
 * @callback TxControl
 */

/**
 * Iambic input class.
 * 
 * This will handle the following things that people appear to want with iambic input:
 * 
 * - Typematic: you hold the key down and it repeats evenly-spaced tones
 * - Typeahead: if you hit a key while it's still transmitting the last-entered one, it queues up your next entered one
 */
class Iambic {
	/**
	 * Create an Iambic control
	 * 
	 * @param {TxControl} beginTxFunc Function to begin transmitting
	 * @param {TxControl} endTxFunc Function to end transmitting
	 * @param {number} intervalDuration Dit duration (milliseconds)
	 */
	constructor(beginTxFunc, endTxFunc, intervalDuration=100) {
		this.beginTxFunc = beginTxFunc
		this.endTxFunc = endTxFunc
		this.intervalDuration = intervalDuration
		this.typematic = null
		this.queue = []
		this.pulseTimer = null
	}

	pulse() {
		if (this.queue.length == 0) {
			if (this.typematic) {
				// Barkeep! Another round!
				this.Enqueue(this.typematic)
			} else {
				// Nothing left on the queue, stop the machine
				this.pulseTimer = null
				return
			}
		}

		let duration = this.queue.shift() * this.intervalDuration
		if (duration < 0) {
			duration = duration * -1
			this.endTxFunc()
		} else {
			this.beginTxFunc()
		}
		this.pulseTimer = setTimeout(() => this.pulse(), duration)
	}

	maybePulse() {
		// If there's no timer running right now, restart the pulse
		if (!this.pulseTimer) {
			this.pulse()
		}
	}

	/**
	  * Set a new dit interval (transmission rate)
	  *
	  * @param {number} duration Dit duration (milliseconds)
	  */
	SetIntervalDuration(duration) {
		this.intervalDuration = duration
	}

	/**
	 * Add to the output queue, and start processing the queue if it's not currently being processed.
	 * 
	 * @param {number} key DIT or DAH
	 */
	Enqueue(key) {
		this.queue.push(key)
		this.queue.push(PAUSE)
		this.maybePulse()
	}

	/**
	  * Edge trigger on key press or release
	  *
	  * @param {number} key DIT or DAH
	  * @param {boolean} down True if key was pressed, false if released
	  */
	Key(key, down) {
		if (down) {
			this.Enqueue(key)
			this.typematic = key
		} else {
			this.typematic = null
		}
	}
}

class Buzzer {
	// Buzzers keep two oscillators: one high and one low.
	// They generate a continuous waveform,
	// and we change the gain to turn the pitches off and on.
	//
	// This also implements a very quick ramp-up and ramp-down in gain,
	// in order to avoid "pops" (square wave overtones)
	// that happen with instant changes in gain.

	constructor(txGain = 0.6) {
		this.txGain = txGain

		this.ac = new AudioContext()

		this.lowGain = this.create(lowFreq)
		this.highGain = this.create(highFreq)
		this.errorGain = this.create(errorFreq, "square")
		this.noiseGain = this.whiteNoise()

		this.ac.resume()
			.then(() => {
				document.querySelector("#muted").classList.add("hidden")
			})

	}

	create(frequency, type = "sine") {
		let gain = this.ac.createGain()
		gain.connect(this.ac.destination)
		gain.gain.value = 0
		let osc = this.ac.createOscillator()
		osc.type = type
		osc.connect(gain)
		osc.frequency.value = frequency
		osc.start()
		return gain
	}

	whiteNoise() {
		let bufferSize = 17 * this.ac.sampleRate
		let noiseBuffer = this.ac.createBuffer(1, bufferSize, this.ac.sampleRate)
		let output = noiseBuffer.getChannelData(0)
		for (let i = 0; i < bufferSize; i++) {
			output[i] = Math.random() * 2 - 1;
		}

		let whiteNoise = this.ac.createBufferSource();
		whiteNoise.buffer = noiseBuffer;
		whiteNoise.loop = true;
		whiteNoise.start(0);

		let filter = this.ac.createBiquadFilter()
		filter.type = "lowpass"
		filter.frequency.value = 100

		let gain = this.ac.createGain()
		gain.gain.value = 0.1

		whiteNoise.connect(filter)
		filter.connect(gain)
		gain.connect(this.ac.destination)

		return gain
	}

	gain(high) {
		if (high) {
			return this.highGain.gain
		} else {
			return this.lowGain.gain
		}
	}

	/**
	  * Convert clock time to AudioContext time
	  *
	  * @param {number} when Clock time in ms
	  * @return {number} AudioContext offset time
	  */
	acTime(when) {
		if (!when) {
			return this.ac.currentTime
		}

		let acOffset = Date.now() - this.ac.currentTime * 1000
		let acTime = (when - acOffset) / 1000
		return acTime
	}

	/**
	  * Set gain
	  *
	  * @param {number} gain Value (0-1)
	  */
	SetGain(gain) {
		this.txGain = gain
	}

	/**
	  * Play an error tone
	  */
	ErrorTone() {
		this.errorGain.gain.setTargetAtTime(this.txGain * 0.5, this.ac.currentTime, 0.001)
		this.errorGain.gain.setTargetAtTime(0, this.ac.currentTime + 0.2, 0.001)
	}

	/**
	  * Begin buzzing at time
	  *
	  * @param {boolean} tx Transmit or receive tone
	  * @param {number} when Time to begin, in ms (null=now)
	  */
	Buzz(tx, when = null) {
		if (!tx) {
			let recv = document.querySelector("#recv")
			let ms = when - Date.now()
			setTimeout(e => {
				recv.classList.add("rx")
			}, ms)
		}

		let gain = this.gain(tx)
		let acWhen = this.acTime(when)
		this.ac.resume()
			.then(() => {
				gain.setTargetAtTime(this.txGain, acWhen, 0.001)
			})
	}

	/**
	  * End buzzing at time
	  *
	  * @param {boolean} tx Transmit or receive tone
	  * @param {number} when Time to end, in ms (null=now)
	  */
	Silence(tx, when = null) {
		if (!tx) {
			let recv = document.querySelector("#recv")
			let ms = when - Date.now()
			setTimeout(e => {
				recv.classList.remove("rx")
			}, ms)
		}

		let gain = this.gain(tx)
		let acWhen = this.acTime(when)

		gain.setTargetAtTime(0, acWhen, 0.001)
	}

	/**
	  * Buzz for a duration at time
	  *
	  * @param {boolean} high High or low pitched tone
	  * @param {number} when Time to begin (ms since 1970-01-01Z, null=now)
	  * @param {number} duration Duration of buzz (ms)
	  */
	BuzzDuration(high, when, duration) {
		this.Buzz(high, when)
		this.Silence(high, when + duration)
	}
}

class Vail {
	constructor() {
		this.sent = []
		this.lagTimes = [0]
		this.rxDurations = [0]
		this.clockOffset = 0 // How badly our clock is off of the server's
		this.rxDelay = 0 // Milliseconds to add to incoming timestamps
		this.beginTxTime = null // Time when we began transmitting
		this.debug = localStorage.debug

		this.openSocket()

		// Listen to HTML buttons
		for (let e of document.querySelectorAll("button.key")) {
			e.addEventListener("contextmenu", e => { e.preventDefault(); return false })
			e.addEventListener("touchstart", e => this.keyButton(e))
			e.addEventListener("touchend", e => this.keyButton(e))
			e.addEventListener("mousedown", e => this.keyButton(e))
			e.addEventListener("mouseup", e => this.keyButton(e))
		}
		for (let e of document.querySelectorAll("button.maximize")) {
			e.addEventListener("click", e => this.maximize(e))
		}

		// Listen for keystrokes
		document.addEventListener("keydown", e => this.keyboard(e))
		document.addEventListener("keyup", e => this.keyboard(e))

		// Make helpers
		this.iambic = new Iambic(() => this.beginTx(), () => this.endTx())
		this.buzzer = new Buzzer()

		// Listen for slider values
		this.inputInit("#iambic-duration", e => this.iambic.SetIntervalDuration(e.target.value))
		this.inputInit("#rx-delay", e => { this.rxDelay = Number(e.target.value) })

		// Show what repeater we're on
		let repeater = (new URL(location)).searchParams.get("repeater") || "General Chaos"
		document.querySelector("#repeater").textContent = repeater

		// Request MIDI access
		if (navigator.requestMIDIAccess) {
			navigator.requestMIDIAccess()
				.then(a => this.midiInit(a))
		}

		// Set up for gamepad input
		window.addEventListener("gamepadconnected", e => this.gamepadConnected(e))
	}

	openSocket() {
		// Set up WebSocket
		let wsUrl = new URL("chat", window.location)
		wsUrl.protocol = wsUrl.protocol.replace("http", "ws")
		this.socket = new WebSocket(wsUrl)
		this.socket.addEventListener("message", e => this.wsMessage(e))
		this.socket.addEventListener("close", e => this.openSocket())
	}

	inputInit(selector, func) {
		let element = document.querySelector(selector)
		let storedValue = localStorage[element.id]
		if (storedValue) {
			element.value = storedValue
		}
		let outputElement = document.querySelector(selector + "-value")
		element.addEventListener("input", e => {
			localStorage[element.id] = element.value
			if (outputElement) {
				outputElement.value = element.value
			}
			func(e)
		})
		element.dispatchEvent(new Event("input"))
	}

	midiInit(access) {
		this.midiAccess = access
		for (let input of this.midiAccess.inputs.values()) {
			input.addEventListener("midimessage", e => this.midiMessage(e))
		}
		this.midiAccess.addEventListener("statechange", e => this.midiStateChange(e))
	}

	midiStateChange(event) {
		// XXX: it's not entirely clear how to handle new devices showing up.
		// XXX: possibly we go through this.midiAccess.inputs and somehow only listen on new things
	}

	midiMessage(event) {
		let data = Array.from(event.data)

		let begin
		let cmd = data[0] >> 4
		let chan = data[0] & 0xf
		switch (cmd) {
			case 9:
				begin = true
				break
			case 8:
				begin = false
				break
			default:
				return
		}

		switch (data[1] % 12) {
			case 0: // C
				this.straightKey(begin)
				break
			case 1: // C#
				this.iambic.Key(DIT, begin)
				break
			case 2: // D
				this.iambic.Key(DAH, begin)
				break
			default:
				return
		}
	}

	error(msg) {
		toast(msg)
		this.buzzer.ErrorTone()
	}

	beginTx() {
		this.beginTxTime = Date.now()
		this.buzzer.Buzz(true)
	}

	endTx() {
		let endTxTime = Date.now()
		let duration = endTxTime - this.beginTxTime
		this.buzzer.Silence(true)
		this.wsSend(this.beginTxTime, duration)
		this.beginTxTime = null
	}

	updateReading(selector, value) {
		let e = document.querySelector(selector)
		if (e) {
			e.value = value
		}
	}

	updateReadings() {
		let avgLag = this.lagTimes.reduce((a, b) => (a + b)) / this.lagTimes.length
		let longestRx = this.rxDurations.reduce((a, b) => Math.max(a, b))
		let suggestedDelay = (avgLag + longestRx) * 1.2

		this.updateReading("#lag-value", avgLag.toFixed())
		this.updateReading("#longest-rx-value", longestRx)
		this.updateReading("#suggested-delay-value", suggestedDelay.toFixed())
		this.updateReading("#clock-off-value", this.clockOffset)
	}

	addLagReading(duration) {
		this.lagTimes.push(duration)
		while (this.lagTimes.length > 20) {
			this.lagTimes.shift()
		}
		this.updateReadings()
	}

	addRxDuration(duration) {
		this.rxDurations.push(duration)
		while (this.rxDurations.length > 20) {
			this.rxDurations.shift()
		}
		this.updateReadings()
	}

	wsSend(time, duration) {
		let msg = [time - this.clockOffset, duration]
		let jmsg = JSON.stringify(msg)
		this.socket.send(jmsg)
		this.sent.push(jmsg)
	}

	wsMessage(event) {
		let now = Date.now()
		let jmsg = event.data
		let msg
		try {
			msg = JSON.parse(jmsg)
		}
		catch (err) {
			console.log(err, msg)
			return
		}
		let beginTxTime = msg[0]
		let durations = msg.slice(1)

		if (this.debug) {
			console.log("recv", beginTxTime, durations)
		}

		let sent = this.sent.filter(e => e != jmsg)
		if (sent.length < this.sent.length) {
			// We're getting our own message back, which tells us our lag.
			// We shouldn't emit a tone, though.
			let totalDuration = durations.reduce((a, b) => a + b)
			this.sent = sent
			this.addLagReading(now - beginTxTime - totalDuration)
			return
		}

		// Server is telling us the current time
		if (durations.length == 0) {
			let offset = now - beginTxTime
			if (this.clockOffset == 0) {
				this.clockOffset = offset
				this.updateReadings()
			}
			return
		}

		// Why is this happening?
		if (beginTxTime == 0) {
			return
		}

		// Add rxDelay
		let adjustedTxTime = beginTxTime + this.rxDelay
		if (adjustedTxTime < now) {
			console.log("adjustedTxTime: ", adjustedTxTime, " now: ", now)
			this.error("Packet requested playback " + (now - adjustedTxTime) + "ms in the past. Increase receive delay!")
			return
		}

		// Every other value is a silence duration
		let tx = true
		for (let duration of durations) {
			duration = Number(duration)
			if (tx && (duration > 0)) {
				this.buzzer.BuzzDuration(false, adjustedTxTime, duration)
				this.addRxDuration(duration)
			}
			adjustedTxTime = Number(adjustedTxTime) + duration
			tx = !tx
		}
	}

	straightKey(begin) {
		if (begin) {
			this.beginTx()
		} else {
			this.endTx()
		}
	}

	iambicDit(begin) {
		this.iambic.Key(DIT, begin)
	}

	iambicDah(begin) {
		this.iambic.Key(DAH, begin)
	}

	keyboard(event) {
		if (event.repeat) {
			// Ignore key repeats generated by the OS, we do this ourselves
			return
		}

		let begin = event.type.endsWith("down")

		if ((event.code == "KeyX") ||
			(event.code == "Period") ||
			(event.code == "ControlLeft") ||
			(event.code == "BracketLeft") ||
			(event.key == "[")) {
			event.preventDefault()
			this.iambicDit(begin)
		}
		if ((event.code == "KeyZ") ||
			(event.code == "Slash") ||
			(event.code == "ControlRight") ||
			(event.code == "BracketRight") ||
			(event.key == "]")) {
			event.preventDefault()
			this.iambicDah(begin)
		}
		if ((event.code == "KeyC") ||
			(event.code == "Comma") ||
			(event.key == "Shift") ||
			(event.key == "Enter") ||
			(event.key == "NumpadEnter")) {
			event.preventDefault()
			this.straightKey(begin)
		}
	}

	keyButton(event) {
		let begin = event.type.endsWith("down") || event.type.endsWith("start")

		event.preventDefault()

		if (event.target.id == "dah") {
			this.iambicDah(begin)
		} else if ((event.target.id == "dit") && (event.button == 2)) {
			this.iambicDah(begin)
		} else if (event.target.id == "dit") {
			this.iambicDit(begin)
		} else if (event.target.id == "key") {
			this.straightKey(begin)
		} else if ((event.target.id == "ck") && begin) {
			this.Test()
		}
	}


	gamepadConnected(event) {
		// Polling could be computationally expensive,
		// especially on devices with a power budget, like phones.
		// To be considerate, we only start polling if a gamepad appears.
		if (!this.gamepadButtons) {
			this.gamepadButtons = {}
			this.gamepadPoll(event.timeStamp)
		}
	}

	gamepadPoll(timestamp) {
		let currentButtons = {}
		for (let gp of navigator.getGamepads()) {
			if (gp == null) {
				continue
			}
			for (let i in gp.buttons) {
				let pressed = gp.buttons[i].pressed
				if (i < 2) {
					currentButtons.key |= pressed
				} else if (i % 2 == 0) {
					currentButtons.dit |= pressed
				} else {
					currentButtons.dah |= pressed
				}
			}
		}

		if (currentButtons.key != this.gamepadButtons.key) {
			this.straightKey(currentButtons.key)
		}
		if (currentButtons.dit != this.gamepadButtons.dit) {
			this.iambicDit(currentButtons.dit)
		}
		if (currentButtons.dah != this.gamepadButtons.dah) {
			this.iambicDah(currentButtons.dah)
		}
		this.gamepadButtons = currentButtons

		requestAnimationFrame(e => this.gamepadPoll(e))
	}

	/**
	  * Send "CK" to server, and don't squelch the repeat
	  */
	Test() {
		let dit = Number(document.querySelector("#iambic-duration-value").value)
		let dah = dit * 3
		let s = dit

		let msg = [
			Date.now(),
			dah, s, dit, s, dah, s, dit,
			s * 3,
			dah, s, dit, s, dah
		]
		this.wsSend(Date.now(), 0) // Get round-trip time
		this.socket.send(JSON.stringify(msg))
	}

	maximize(e) {
		let element = e.target
		while (!element.classList.contains("mdl-card")) {
			element = element.parentElement
			if (!element) {
				console.log("Maximize button: couldn't find parent card")
				return
			}
		}
		element.classList.toggle("maximized")
		console.log(element)
	}


}

function vailInit() {
	if (navigator.serviceWorker) {
		navigator.serviceWorker.register("sw.js")
	}
	try {
		window.app = new Vail()
	} catch (err) {
		console.log(err)
		toast(err)
	}
}


if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", vailInit)
} else {
	vailInit()
}

// vim: noet sw=2 ts=2
