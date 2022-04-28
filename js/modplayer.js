/*
 * forked from https://github.com/warpdesign/modplayer-js/
 * Removed all rendering stuff
 */

const ModPlayer = {
    context: null,
    mixerNode: null,
    workletNode: null,
    module: null,
    buffer: null,
    mixingRate: 44100,
    playing: false,
    bufferFull: false,
    ready: true,
    loaded: false,
    init(options) {
        this.audioWorkletSupport = !!AudioWorkletNode.toString().match(/native code/);
        this.channels = [true, true, true, true];
        return this.createContext();
    },

    loadFileBuffer(file) {
        if (!this.ready) {
            return;
        } else {
            this.ready = false;
        }
        this.loaded = false;
        this.wasPlaying = this.playing;
        if(!this.context) {
            console.log('Create context');
            this.createContext();
        }
        this.pause();
        let fileReader = new FileReader();
        fileReader.onload = () => {
            this.postMessage({
                message: 'loadModule',
                buffer: fileReader.result
            });
            };
        fileReader.readAsArrayBuffer(file);
    },

    async loadModule(url) {
        if (!this.ready) {
            return;
        } else {
            this.ready = false;
        }

        this.loaded = false;
        this.wasPlaying = this.playing;

        this.pause();

        if (!this.context) {
            this.createContext();
        }

        const buffer = await this.loadBinary(url);
        this.postMessage({
            message: 'loadModule',
            buffer: buffer
        });

        this.ready = true;
    },

    async loadBinary(url) {
        const response = await Utils.betterFetch(url);
        const buffer = await response.arrayBuffer();
        return buffer;
    },

    createContext() {
        this.context = new (window.AudioContext || window.webkitAudioContext)();

        this.mixingRate = this.context.sampleRate;

        const soundProcessor = 'modplayer-processor.js';

        return this.context.audioWorklet.addModule(`/js/${soundProcessor}`).then(() => {
            const numAnalysers = this.audioWorkletSupport && 4 || 2;

            // apply a filter
            this.filterNode = this.context.createBiquadFilter();
            this.filterNode.frequency.value = 22050;

            // Use 4 inputs that will be used to send each track's data to a separate analyser
            // NOTE: what should we do if we support more channels (and different mod formats)?
            this.workletNode = new AudioWorkletNode(this.context, 'mod-processor', {
                outputChannelCount: [1, 1, 1, 1],
                numberOfInputs: 0,
                numberOfOutputs: 4
            });

            if (!this.audioWorkletSupport) {
                this.splitter = this.context.createChannelSplitter(numAnalysers);
                this.filterNode.connect(this.splitter);
            }

            this.workletNode.port.onmessage = this.handleMessage.bind(this);
            this.postMessage({
                message: 'init',
                mixingRate: this.mixingRate,
                audioWorkletSupport: this.audioWorkletSupport
            });
            this.workletNode.port.start();

            // create four analysers and connect each worklet's input to one
            this.analysers = new Array();

            for (let i = 0; i < numAnalysers; ++i) {
                const analyser = this.context.createAnalyser();
                analyser.fftSize = 256;// Math.pow(2, 11);
                analyser.minDecibels = -90;
                analyser.maxDecibels = -10;
                analyser.smoothingTimeConstant = 0.65;
                if (this.audioWorkletSupport) {
                    this.workletNode.connect(analyser, i, 0);
                } else {
                    this.splitter.connect(analyser, i);
                }
                this.analysers.push(analyser);
            }

            if (this.audioWorkletSupport) {
                this.merger = this.context.createChannelMerger(4);

                // merge the channel 0+3 in left channel, 1+2 in right channel
                this.workletNode.connect(this.merger, 0, 0);
                this.workletNode.connect(this.merger, 1, 1);
                this.workletNode.connect(this.merger, 2, 1);
                this.workletNode.connect(this.merger, 3, 0);

                // finally apply the lowpass filter and send audio to destination
                this.merger.connect(this.filterNode);
            } else {
                this.workletNode.connect(this.filterNode);
            }


            this.filterNode.connect(this.context.destination);
        });
    },

    setLowPass(activate) {
        this.filterNode.frequency.value = activate && 6000 || 22050;
    },

    setSpeed(speedUp) {
        this.postMessage({
            message: 'speedUp',
            speedUp: speedUp
        });
    },

    handleMessage(message) {
        switch (message.data.message) {
            case 'moduleLoaded':
                this.loaded = true;
                const event = new Event('moduleLoaded');
                event.data = message.data.data;
                event.data.wasPlaying = this.wasPlaying;
                document.dispatchEvent(event);
                break;

            case 'toggleLowPass':
                this.setLowPass(message.data.data.activate);
                break;
        }
    },

    postMessage(message) {
		this.workletNode.port.postMessage(message);
    },

    play() {
        if (this.loaded) {
            // on Safari macOS/iOS, the audioContext is suspended if it's not created
            // in the event handler of a user action: we attempt to resume it.
            if (this.context.state === 'suspended') {
                this.context.resume();
            }

            this.playing = !this.playing;

            if (!this.playing) {
                this.pause();
            }

            this.sendPlayingStatus();
        } 
    },

    stop() {
        this.pause();
        if (this.ready) {
            this.postMessage({
                message: 'reset'
            });
        }

        this.setLowPass(false);
    },

    pause() {
        this.playing = false;
        this.sendPlayingStatus();
    },

    sendPlayingStatus() {
		this.postMessage({
            message: 'setPlay',
            playing: this.playing
        });
    },

    setPlayingChannels(channels) {
		this.postMessage({
            message: 'setPlayingChannels',
            channels: channels
        });

        this.channels = channels;
    },

}
