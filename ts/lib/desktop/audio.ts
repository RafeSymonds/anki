// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

/**
 * Plays the [sound:] and {{tts}} tags of a card, one after another, the way
 * aqt.sound.av_player does. Sound files stream from the media folder through
 * the anki:// scheme; text to speech uses the system voices WebKit exposes.
 */

import type { AVTag, TTSTag } from "@generated/anki/card_rendering_pb";

export function mediaUrl(filename: string): string {
    return "/" + encodeURIComponent(filename);
}

export class AvPlayer {
    private queue: AVTag[] = [];
    private audio: HTMLAudioElement | null = null;
    private utterance: SpeechSynthesisUtterance | null = null;
    /** Called when the whole queue has finished. */
    onQueueEnded: (() => void) | null = null;

    get playing(): boolean {
        return this.audio !== null || this.utterance !== null;
    }

    playTags(tags: AVTag[]): void {
        this.stop();
        this.queue = [...tags];
        this.playNext();
    }

    stop(): void {
        this.queue = [];
        if (this.audio) {
            this.audio.onended = null;
            this.audio.onerror = null;
            this.audio.pause();
            this.audio = null;
        }
        if (this.utterance) {
            this.utterance = null;
            if (typeof speechSynthesis !== "undefined") {
                speechSynthesis.cancel();
            }
        }
    }

    togglePause(): void {
        if (this.audio) {
            if (this.audio.paused) {
                void this.audio.play();
            } else {
                this.audio.pause();
            }
        } else if (this.utterance && typeof speechSynthesis !== "undefined") {
            if (speechSynthesis.paused) {
                speechSynthesis.resume();
            } else {
                speechSynthesis.pause();
            }
        }
    }

    seekRelative(seconds: number): void {
        if (this.audio) {
            this.audio.currentTime = Math.max(0, this.audio.currentTime + seconds);
        }
    }

    private playNext(): void {
        const tag = this.queue.shift();
        if (!tag) {
            this.onQueueEnded?.();
            return;
        }
        switch (tag.value.case) {
            case "soundOrVideo":
                this.playFile(tag.value.value);
                break;
            case "tts":
                this.speak(tag.value.value);
                break;
            default:
                this.playNext();
        }
    }

    private playFile(filename: string): void {
        const audio = new Audio(mediaUrl(filename));
        this.audio = audio;
        const done = (): void => {
            if (this.audio === audio) {
                this.audio = null;
                this.playNext();
            }
        };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
    }

    private speak(tag: TTSTag): void {
        if (typeof speechSynthesis === "undefined") {
            this.playNext();
            return;
        }
        const utterance = new SpeechSynthesisUtterance(tag.fieldText);
        utterance.lang = tag.lang.replace("_", "-");
        if (tag.speed) {
            utterance.rate = tag.speed;
        }
        const wanted = tag.voices.map((v) => v.toLowerCase());
        if (wanted.length) {
            const voice = speechSynthesis
                .getVoices()
                .find((v) => wanted.includes(v.name.toLowerCase()) || wanted.includes(v.voiceURI.toLowerCase()));
            if (voice) {
                utterance.voice = voice;
            }
        }
        this.utterance = utterance;
        const done = (): void => {
            if (this.utterance === utterance) {
                this.utterance = null;
                this.playNext();
            }
        };
        utterance.onend = done;
        utterance.onerror = done;
        speechSynthesis.speak(utterance);
    }
}

export const avPlayer = new AvPlayer();
