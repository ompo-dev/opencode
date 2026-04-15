type Mode = "webaudio" | "htmlaudio" | "none";
type State = "idle" | "loading" | "playing" | "blocked" | "error";
export type AudioQueueState = {
    state: State;
    pending: number;
    mode: Mode;
    muted: boolean;
    volume: number;
    error?: string;
};
export declare function createAudioQueue(input?: {
    muted?: () => boolean;
    volume?: () => number;
    note?: (state: AudioQueueState) => void;
}): {
    enqueue(src: string): void;
    clear(): void;
    update(): void;
    dispose(): void;
    state(): AudioQueueState;
};
export {};
