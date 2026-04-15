import z from "zod";
export declare const voiceTags: readonly ["[laughter]", "[sigh]", "[confirmation-en]", "[question-en]", "[question-ah]", "[question-oh]", "[question-ei]", "[question-yi]", "[surprise-ah]", "[surprise-oh]", "[surprise-wa]", "[surprise-yo]", "[dissatisfaction-hnn]"];
export declare const VoiceTag: z.ZodEnum<{
    "[confirmation-en]": "[confirmation-en]";
    "[dissatisfaction-hnn]": "[dissatisfaction-hnn]";
    "[laughter]": "[laughter]";
    "[question-ah]": "[question-ah]";
    "[question-ei]": "[question-ei]";
    "[question-en]": "[question-en]";
    "[question-oh]": "[question-oh]";
    "[question-yi]": "[question-yi]";
    "[sigh]": "[sigh]";
    "[surprise-ah]": "[surprise-ah]";
    "[surprise-oh]": "[surprise-oh]";
    "[surprise-wa]": "[surprise-wa]";
    "[surprise-yo]": "[surprise-yo]";
}>;
export declare const VoiceMode: z.ZodEnum<{
    auto: "auto";
    clone: "clone";
    design: "design";
}>;
export declare const VoiceDesign: z.ZodObject<{
    gender: z.ZodOptional<z.ZodString>;
    age: z.ZodOptional<z.ZodString>;
    pitch: z.ZodOptional<z.ZodString>;
    style: z.ZodOptional<z.ZodString>;
    english_accent: z.ZodOptional<z.ZodString>;
    chinese_dialect: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const Runtime: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    python: z.ZodOptional<z.ZodString>;
    device: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        cpu: "cpu";
        cuda: "cuda";
        mps: "mps";
    }>>;
    dtype: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        float16: "float16";
        float32: "float32";
        int8: "int8";
    }>>;
    install_on_demand: z.ZodOptional<z.ZodBoolean>;
    hf_token: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const Stt: z.ZodObject<{
    provider: z.ZodOptional<z.ZodLiteral<"whisperx">>;
    model: z.ZodOptional<z.ZodString>;
    language: z.ZodOptional<z.ZodString>;
    timestamps: z.ZodOptional<z.ZodEnum<{
        none: "none";
        segment: "segment";
        word: "word";
    }>>;
    diarization: z.ZodOptional<z.ZodBoolean>;
    vad: z.ZodOptional<z.ZodBoolean>;
    compute_type: z.ZodOptional<z.ZodEnum<{
        float16: "float16";
        float32: "float32";
        int8: "int8";
    }>>;
    batch_size: z.ZodOptional<z.ZodNumber>;
    beam_size: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const Preset: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    mode: z.ZodEnum<{
        auto: "auto";
        clone: "clone";
        design: "design";
    }>;
    ref_audio_path: z.ZodOptional<z.ZodString>;
    ref_text: z.ZodOptional<z.ZodString>;
    instruct: z.ZodOptional<z.ZodString>;
    design: z.ZodOptional<z.ZodObject<{
        gender: z.ZodOptional<z.ZodString>;
        age: z.ZodOptional<z.ZodString>;
        pitch: z.ZodOptional<z.ZodString>;
        style: z.ZodOptional<z.ZodString>;
        english_accent: z.ZodOptional<z.ZodString>;
        chinese_dialect: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "[confirmation-en]": "[confirmation-en]";
        "[dissatisfaction-hnn]": "[dissatisfaction-hnn]";
        "[laughter]": "[laughter]";
        "[question-ah]": "[question-ah]";
        "[question-ei]": "[question-ei]";
        "[question-en]": "[question-en]";
        "[question-oh]": "[question-oh]";
        "[question-yi]": "[question-yi]";
        "[sigh]": "[sigh]";
        "[surprise-ah]": "[surprise-ah]";
        "[surprise-oh]": "[surprise-oh]";
        "[surprise-wa]": "[surprise-wa]";
        "[surprise-yo]": "[surprise-yo]";
    }>>>;
    language: z.ZodOptional<z.ZodString>;
    speed: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const Tts: z.ZodObject<{
    provider: z.ZodOptional<z.ZodLiteral<"omnivoice">>;
    default_preset: z.ZodOptional<z.ZodString>;
    presets: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        mode: z.ZodEnum<{
            auto: "auto";
            clone: "clone";
            design: "design";
        }>;
        ref_audio_path: z.ZodOptional<z.ZodString>;
        ref_text: z.ZodOptional<z.ZodString>;
        instruct: z.ZodOptional<z.ZodString>;
        design: z.ZodOptional<z.ZodObject<{
            gender: z.ZodOptional<z.ZodString>;
            age: z.ZodOptional<z.ZodString>;
            pitch: z.ZodOptional<z.ZodString>;
            style: z.ZodOptional<z.ZodString>;
            english_accent: z.ZodOptional<z.ZodString>;
            chinese_dialect: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        tags: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            "[confirmation-en]": "[confirmation-en]";
            "[dissatisfaction-hnn]": "[dissatisfaction-hnn]";
            "[laughter]": "[laughter]";
            "[question-ah]": "[question-ah]";
            "[question-ei]": "[question-ei]";
            "[question-en]": "[question-en]";
            "[question-oh]": "[question-oh]";
            "[question-yi]": "[question-yi]";
            "[sigh]": "[sigh]";
            "[surprise-ah]": "[surprise-ah]";
            "[surprise-oh]": "[surprise-oh]";
            "[surprise-wa]": "[surprise-wa]";
            "[surprise-yo]": "[surprise-yo]";
        }>>>;
        language: z.ZodOptional<z.ZodString>;
        speed: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
    live: z.ZodOptional<z.ZodBoolean>;
    autoplay: z.ZodOptional<z.ZodBoolean>;
    chunking: z.ZodOptional<z.ZodEnum<{
        sentence: "sentence";
    }>>;
    stop_on_interrupt: z.ZodOptional<z.ZodBoolean>;
    strip_markdown: z.ZodOptional<z.ZodBoolean>;
    speed: z.ZodOptional<z.ZodNumber>;
    duration: z.ZodOptional<z.ZodNumber>;
    num_step: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const VoiceSchema: z.ZodObject<{
    runtime: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        python: z.ZodOptional<z.ZodString>;
        device: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            cpu: "cpu";
            cuda: "cuda";
            mps: "mps";
        }>>;
        dtype: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            float16: "float16";
            float32: "float32";
            int8: "int8";
        }>>;
        install_on_demand: z.ZodOptional<z.ZodBoolean>;
        hf_token: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    stt: z.ZodOptional<z.ZodObject<{
        provider: z.ZodOptional<z.ZodLiteral<"whisperx">>;
        model: z.ZodOptional<z.ZodString>;
        language: z.ZodOptional<z.ZodString>;
        timestamps: z.ZodOptional<z.ZodEnum<{
            none: "none";
            segment: "segment";
            word: "word";
        }>>;
        diarization: z.ZodOptional<z.ZodBoolean>;
        vad: z.ZodOptional<z.ZodBoolean>;
        compute_type: z.ZodOptional<z.ZodEnum<{
            float16: "float16";
            float32: "float32";
            int8: "int8";
        }>>;
        batch_size: z.ZodOptional<z.ZodNumber>;
        beam_size: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    tts: z.ZodOptional<z.ZodObject<{
        provider: z.ZodOptional<z.ZodLiteral<"omnivoice">>;
        default_preset: z.ZodOptional<z.ZodString>;
        presets: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            mode: z.ZodEnum<{
                auto: "auto";
                clone: "clone";
                design: "design";
            }>;
            ref_audio_path: z.ZodOptional<z.ZodString>;
            ref_text: z.ZodOptional<z.ZodString>;
            instruct: z.ZodOptional<z.ZodString>;
            design: z.ZodOptional<z.ZodObject<{
                gender: z.ZodOptional<z.ZodString>;
                age: z.ZodOptional<z.ZodString>;
                pitch: z.ZodOptional<z.ZodString>;
                style: z.ZodOptional<z.ZodString>;
                english_accent: z.ZodOptional<z.ZodString>;
                chinese_dialect: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            tags: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                "[confirmation-en]": "[confirmation-en]";
                "[dissatisfaction-hnn]": "[dissatisfaction-hnn]";
                "[laughter]": "[laughter]";
                "[question-ah]": "[question-ah]";
                "[question-ei]": "[question-ei]";
                "[question-en]": "[question-en]";
                "[question-oh]": "[question-oh]";
                "[question-yi]": "[question-yi]";
                "[sigh]": "[sigh]";
                "[surprise-ah]": "[surprise-ah]";
                "[surprise-oh]": "[surprise-oh]";
                "[surprise-wa]": "[surprise-wa]";
                "[surprise-yo]": "[surprise-yo]";
            }>>>;
            language: z.ZodOptional<z.ZodString>;
            speed: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>>;
        live: z.ZodOptional<z.ZodBoolean>;
        autoplay: z.ZodOptional<z.ZodBoolean>;
        chunking: z.ZodOptional<z.ZodEnum<{
            sentence: "sentence";
        }>>;
        stop_on_interrupt: z.ZodOptional<z.ZodBoolean>;
        strip_markdown: z.ZodOptional<z.ZodBoolean>;
        speed: z.ZodOptional<z.ZodNumber>;
        duration: z.ZodOptional<z.ZodNumber>;
        num_step: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const RuntimeCfg: z.ZodObject<{
    enabled: z.ZodBoolean;
    python: z.ZodString;
    device: z.ZodEnum<{
        auto: "auto";
        cpu: "cpu";
        cuda: "cuda";
        mps: "mps";
    }>;
    dtype: z.ZodEnum<{
        auto: "auto";
        float16: "float16";
        float32: "float32";
        int8: "int8";
    }>;
    install_on_demand: z.ZodBoolean;
    hf_token: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const SttCfg: z.ZodObject<{
    provider: z.ZodLiteral<"whisperx">;
    model: z.ZodString;
    language: z.ZodString;
    timestamps: z.ZodEnum<{
        none: "none";
        segment: "segment";
        word: "word";
    }>;
    diarization: z.ZodBoolean;
    vad: z.ZodBoolean;
    compute_type: z.ZodEnum<{
        float16: "float16";
        float32: "float32";
        int8: "int8";
    }>;
    batch_size: z.ZodNumber;
    beam_size: z.ZodNumber;
}, z.core.$strict>;
export declare const TtsCfg: z.ZodObject<{
    provider: z.ZodLiteral<"omnivoice">;
    default_preset: z.ZodOptional<z.ZodString>;
    presets: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        mode: z.ZodEnum<{
            auto: "auto";
            clone: "clone";
            design: "design";
        }>;
        ref_audio_path: z.ZodOptional<z.ZodString>;
        ref_text: z.ZodOptional<z.ZodString>;
        instruct: z.ZodOptional<z.ZodString>;
        design: z.ZodOptional<z.ZodObject<{
            gender: z.ZodOptional<z.ZodString>;
            age: z.ZodOptional<z.ZodString>;
            pitch: z.ZodOptional<z.ZodString>;
            style: z.ZodOptional<z.ZodString>;
            english_accent: z.ZodOptional<z.ZodString>;
            chinese_dialect: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        tags: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            "[confirmation-en]": "[confirmation-en]";
            "[dissatisfaction-hnn]": "[dissatisfaction-hnn]";
            "[laughter]": "[laughter]";
            "[question-ah]": "[question-ah]";
            "[question-ei]": "[question-ei]";
            "[question-en]": "[question-en]";
            "[question-oh]": "[question-oh]";
            "[question-yi]": "[question-yi]";
            "[sigh]": "[sigh]";
            "[surprise-ah]": "[surprise-ah]";
            "[surprise-oh]": "[surprise-oh]";
            "[surprise-wa]": "[surprise-wa]";
            "[surprise-yo]": "[surprise-yo]";
        }>>>;
        language: z.ZodOptional<z.ZodString>;
        speed: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    live: z.ZodBoolean;
    autoplay: z.ZodBoolean;
    chunking: z.ZodEnum<{
        sentence: "sentence";
    }>;
    stop_on_interrupt: z.ZodBoolean;
    strip_markdown: z.ZodBoolean;
    speed: z.ZodNumber;
    duration: z.ZodOptional<z.ZodNumber>;
    num_step: z.ZodNumber;
}, z.core.$strict>;
export declare const ConfigCfg: z.ZodObject<{
    runtime: z.ZodObject<{
        enabled: z.ZodBoolean;
        python: z.ZodString;
        device: z.ZodEnum<{
            auto: "auto";
            cpu: "cpu";
            cuda: "cuda";
            mps: "mps";
        }>;
        dtype: z.ZodEnum<{
            auto: "auto";
            float16: "float16";
            float32: "float32";
            int8: "int8";
        }>;
        install_on_demand: z.ZodBoolean;
        hf_token: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    stt: z.ZodObject<{
        provider: z.ZodLiteral<"whisperx">;
        model: z.ZodString;
        language: z.ZodString;
        timestamps: z.ZodEnum<{
            none: "none";
            segment: "segment";
            word: "word";
        }>;
        diarization: z.ZodBoolean;
        vad: z.ZodBoolean;
        compute_type: z.ZodEnum<{
            float16: "float16";
            float32: "float32";
            int8: "int8";
        }>;
        batch_size: z.ZodNumber;
        beam_size: z.ZodNumber;
    }, z.core.$strict>;
    tts: z.ZodObject<{
        provider: z.ZodLiteral<"omnivoice">;
        default_preset: z.ZodOptional<z.ZodString>;
        presets: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            mode: z.ZodEnum<{
                auto: "auto";
                clone: "clone";
                design: "design";
            }>;
            ref_audio_path: z.ZodOptional<z.ZodString>;
            ref_text: z.ZodOptional<z.ZodString>;
            instruct: z.ZodOptional<z.ZodString>;
            design: z.ZodOptional<z.ZodObject<{
                gender: z.ZodOptional<z.ZodString>;
                age: z.ZodOptional<z.ZodString>;
                pitch: z.ZodOptional<z.ZodString>;
                style: z.ZodOptional<z.ZodString>;
                english_accent: z.ZodOptional<z.ZodString>;
                chinese_dialect: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            tags: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                "[confirmation-en]": "[confirmation-en]";
                "[dissatisfaction-hnn]": "[dissatisfaction-hnn]";
                "[laughter]": "[laughter]";
                "[question-ah]": "[question-ah]";
                "[question-ei]": "[question-ei]";
                "[question-en]": "[question-en]";
                "[question-oh]": "[question-oh]";
                "[question-yi]": "[question-yi]";
                "[sigh]": "[sigh]";
                "[surprise-ah]": "[surprise-ah]";
                "[surprise-oh]": "[surprise-oh]";
                "[surprise-wa]": "[surprise-wa]";
                "[surprise-yo]": "[surprise-yo]";
            }>>>;
            language: z.ZodOptional<z.ZodString>;
            speed: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        live: z.ZodBoolean;
        autoplay: z.ZodBoolean;
        chunking: z.ZodEnum<{
            sentence: "sentence";
        }>;
        stop_on_interrupt: z.ZodBoolean;
        strip_markdown: z.ZodBoolean;
        speed: z.ZodNumber;
        duration: z.ZodOptional<z.ZodNumber>;
        num_step: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const Paths: z.ZodObject<{
    root: z.ZodString;
    references: z.ZodString;
    stt_root: z.ZodString;
    stt_venv: z.ZodString;
    stt_python: z.ZodString;
    stt_marker: z.ZodString;
    tts_root: z.ZodString;
    tts_venv: z.ZodString;
    tts_python: z.ZodString;
    tts_marker: z.ZodString;
    ffmpeg_dir: z.ZodString;
    ffmpeg: z.ZodOptional<z.ZodString>;
    ffprobe: z.ZodOptional<z.ZodString>;
    hf: z.ZodString;
    tmp: z.ZodString;
}, z.core.$strict>;
export declare const Phase: z.ZodEnum<{
    busy: "busy";
    disabled: "disabled";
    ensuring: "ensuring";
    error: "error";
    idle: "idle";
    ready: "ready";
    starting: "starting";
}>;
export declare const Status: z.ZodObject<{
    ready: z.ZodBoolean;
    phase: z.ZodEnum<{
        busy: "busy";
        disabled: "disabled";
        ensuring: "ensuring";
        error: "error";
        idle: "idle";
        ready: "ready";
        starting: "starting";
    }>;
    active_engine: z.ZodNullable<z.ZodEnum<{
        stt: "stt";
        tts: "tts";
    }>>;
    device: z.ZodString;
    diarization: z.ZodBoolean;
    worker: z.ZodBoolean;
    ffmpeg: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
    config: z.ZodObject<{
        runtime: z.ZodObject<{
            enabled: z.ZodBoolean;
            python: z.ZodString;
            device: z.ZodEnum<{
                auto: "auto";
                cpu: "cpu";
                cuda: "cuda";
                mps: "mps";
            }>;
            dtype: z.ZodEnum<{
                auto: "auto";
                float16: "float16";
                float32: "float32";
                int8: "int8";
            }>;
            install_on_demand: z.ZodBoolean;
            hf_token: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        stt: z.ZodObject<{
            provider: z.ZodLiteral<"whisperx">;
            model: z.ZodString;
            language: z.ZodString;
            timestamps: z.ZodEnum<{
                none: "none";
                segment: "segment";
                word: "word";
            }>;
            diarization: z.ZodBoolean;
            vad: z.ZodBoolean;
            compute_type: z.ZodEnum<{
                float16: "float16";
                float32: "float32";
                int8: "int8";
            }>;
            batch_size: z.ZodNumber;
            beam_size: z.ZodNumber;
        }, z.core.$strict>;
        tts: z.ZodObject<{
            provider: z.ZodLiteral<"omnivoice">;
            default_preset: z.ZodOptional<z.ZodString>;
            presets: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                mode: z.ZodEnum<{
                    auto: "auto";
                    clone: "clone";
                    design: "design";
                }>;
                ref_audio_path: z.ZodOptional<z.ZodString>;
                ref_text: z.ZodOptional<z.ZodString>;
                instruct: z.ZodOptional<z.ZodString>;
                design: z.ZodOptional<z.ZodObject<{
                    gender: z.ZodOptional<z.ZodString>;
                    age: z.ZodOptional<z.ZodString>;
                    pitch: z.ZodOptional<z.ZodString>;
                    style: z.ZodOptional<z.ZodString>;
                    english_accent: z.ZodOptional<z.ZodString>;
                    chinese_dialect: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
                tags: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    "[confirmation-en]": "[confirmation-en]";
                    "[dissatisfaction-hnn]": "[dissatisfaction-hnn]";
                    "[laughter]": "[laughter]";
                    "[question-ah]": "[question-ah]";
                    "[question-ei]": "[question-ei]";
                    "[question-en]": "[question-en]";
                    "[question-oh]": "[question-oh]";
                    "[question-yi]": "[question-yi]";
                    "[sigh]": "[sigh]";
                    "[surprise-ah]": "[surprise-ah]";
                    "[surprise-oh]": "[surprise-oh]";
                    "[surprise-wa]": "[surprise-wa]";
                    "[surprise-yo]": "[surprise-yo]";
                }>>>;
                language: z.ZodOptional<z.ZodString>;
                speed: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            live: z.ZodBoolean;
            autoplay: z.ZodBoolean;
            chunking: z.ZodEnum<{
                sentence: "sentence";
            }>;
            stop_on_interrupt: z.ZodBoolean;
            strip_markdown: z.ZodBoolean;
            speed: z.ZodNumber;
            duration: z.ZodOptional<z.ZodNumber>;
            num_step: z.ZodNumber;
        }, z.core.$strict>;
    }, z.core.$strict>;
    paths: z.ZodObject<{
        root: z.ZodString;
        references: z.ZodString;
        stt_root: z.ZodString;
        stt_venv: z.ZodString;
        stt_python: z.ZodString;
        stt_marker: z.ZodString;
        tts_root: z.ZodString;
        tts_venv: z.ZodString;
        tts_python: z.ZodString;
        tts_marker: z.ZodString;
        ffmpeg_dir: z.ZodString;
        ffmpeg: z.ZodOptional<z.ZodString>;
        ffprobe: z.ZodOptional<z.ZodString>;
        hf: z.ZodString;
        tmp: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const EnsureInput: z.ZodObject<{
    preload: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const ReferenceInput: z.ZodObject<{
    audio: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    duration_ms: z.ZodOptional<z.ZodNumber>;
    transcribe: z.ZodOptional<z.ZodBoolean>;
    language: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const ReferenceOutput: z.ZodObject<{
    path: z.ZodString;
    name: z.ZodString;
    duration_ms: z.ZodNumber;
    text: z.ZodOptional<z.ZodString>;
    language: z.ZodOptional<z.ZodString>;
    transcript_error: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const AssetInput: z.ZodObject<{
    path: z.ZodString;
}, z.core.$strict>;
export declare const AssetOutput: z.ZodObject<{
    path: z.ZodString;
    name: z.ZodString;
    audio: z.ZodString;
}, z.core.$strict>;
export declare const Word: z.ZodObject<{
    word: z.ZodString;
    start: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    end: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    score: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    speaker: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const Segment: z.ZodObject<{
    id: z.ZodOptional<z.ZodNumber>;
    text: z.ZodString;
    start: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    end: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    speaker: z.ZodOptional<z.ZodString>;
    words: z.ZodOptional<z.ZodArray<z.ZodObject<{
        word: z.ZodString;
        start: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        end: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        score: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        speaker: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const TranscribeInput: z.ZodObject<{
    audio: z.ZodString;
    language: z.ZodOptional<z.ZodString>;
    diarization: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const TranscribeOutput: z.ZodObject<{
    text: z.ZodString;
    language: z.ZodOptional<z.ZodString>;
    duration_ms: z.ZodNumber;
    segments: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodNumber>;
        text: z.ZodString;
        start: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        end: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        speaker: z.ZodOptional<z.ZodString>;
        words: z.ZodOptional<z.ZodArray<z.ZodObject<{
            word: z.ZodString;
            start: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            end: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            score: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            speaker: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    words: z.ZodArray<z.ZodObject<{
        word: z.ZodString;
        start: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        end: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        score: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        speaker: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    speaker_labels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    raw: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>;
export declare const SynthesizeInput: z.ZodObject<{
    text: z.ZodString;
    preset: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        clone: "clone";
        design: "design";
    }>>;
    ref_audio_path: z.ZodOptional<z.ZodString>;
    ref_text: z.ZodOptional<z.ZodString>;
    instruct: z.ZodOptional<z.ZodString>;
    design: z.ZodOptional<z.ZodObject<{
        gender: z.ZodOptional<z.ZodString>;
        age: z.ZodOptional<z.ZodString>;
        pitch: z.ZodOptional<z.ZodString>;
        style: z.ZodOptional<z.ZodString>;
        english_accent: z.ZodOptional<z.ZodString>;
        chinese_dialect: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "[confirmation-en]": "[confirmation-en]";
        "[dissatisfaction-hnn]": "[dissatisfaction-hnn]";
        "[laughter]": "[laughter]";
        "[question-ah]": "[question-ah]";
        "[question-ei]": "[question-ei]";
        "[question-en]": "[question-en]";
        "[question-oh]": "[question-oh]";
        "[question-yi]": "[question-yi]";
        "[sigh]": "[sigh]";
        "[surprise-ah]": "[surprise-ah]";
        "[surprise-oh]": "[surprise-oh]";
        "[surprise-wa]": "[surprise-wa]";
        "[surprise-yo]": "[surprise-yo]";
    }>>>;
    language: z.ZodOptional<z.ZodString>;
    speed: z.ZodOptional<z.ZodNumber>;
    duration: z.ZodOptional<z.ZodNumber>;
    num_step: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const SynthesizeOutput: z.ZodObject<{
    mime: z.ZodString;
    sample_rate: z.ZodNumber;
    duration_ms: z.ZodNumber;
    text_used: z.ZodString;
    audio: z.ZodString;
    meta: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>;
export type VoiceConfig = z.infer<typeof VoiceSchema>;
export type VoiceConfigResolved = z.infer<typeof ConfigCfg>;
export type VoiceStatus = z.infer<typeof Status>;
export type VoicePreset = z.infer<typeof Preset>;
export type VoiceDesign = z.infer<typeof VoiceDesign>;
export type VoiceReferenceInput = z.infer<typeof ReferenceInput>;
export type VoiceReferenceOutput = z.infer<typeof ReferenceOutput>;
export type VoiceAssetInput = z.infer<typeof AssetInput>;
export type VoiceAssetOutput = z.infer<typeof AssetOutput>;
export type VoiceTranscribeInput = z.infer<typeof TranscribeInput>;
export type VoiceTranscribeOutput = z.infer<typeof TranscribeOutput>;
export type VoiceSynthesizeInput = z.infer<typeof SynthesizeInput>;
export type VoiceSynthesizeOutput = z.infer<typeof SynthesizeOutput>;
export declare function voicePreset(input: z.input<typeof ConfigCfg>, id?: string): {
    id: string;
    name: string;
    mode: "auto" | "clone" | "design";
    ref_audio_path?: string | undefined;
    ref_text?: string | undefined;
    instruct?: string | undefined;
    design?: {
        gender?: string | undefined;
        age?: string | undefined;
        pitch?: string | undefined;
        style?: string | undefined;
        english_accent?: string | undefined;
        chinese_dialect?: string | undefined;
    } | undefined;
    tags?: ("[confirmation-en]" | "[dissatisfaction-hnn]" | "[laughter]" | "[question-ah]" | "[question-ei]" | "[question-en]" | "[question-oh]" | "[question-yi]" | "[sigh]" | "[surprise-ah]" | "[surprise-oh]" | "[surprise-wa]" | "[surprise-yo]")[] | undefined;
    language?: string | undefined;
    speed?: number | undefined;
} | undefined;
export declare function voiceInput(input: {
    config: z.input<typeof ConfigCfg>;
    text: string;
    preset?: string;
}): {
    text: string;
    preset?: string | undefined;
    mode?: "auto" | "clone" | "design" | undefined;
    ref_audio_path?: string | undefined;
    ref_text?: string | undefined;
    instruct?: string | undefined;
    design?: {
        gender?: string | undefined;
        age?: string | undefined;
        pitch?: string | undefined;
        style?: string | undefined;
        english_accent?: string | undefined;
        chinese_dialect?: string | undefined;
    } | undefined;
    tags?: ("[confirmation-en]" | "[dissatisfaction-hnn]" | "[laughter]" | "[question-ah]" | "[question-ei]" | "[question-en]" | "[question-oh]" | "[question-yi]" | "[sigh]" | "[surprise-ah]" | "[surprise-oh]" | "[surprise-wa]" | "[surprise-yo]")[] | undefined;
    language?: string | undefined;
    speed?: number | undefined;
    duration?: number | undefined;
    num_step?: number | undefined;
};
export declare function voiceDesignText(input?: z.input<typeof VoiceDesign>): string | undefined;
export declare function runtimeCfg(input?: z.input<typeof Runtime>): {
    enabled: boolean;
    python: string;
    device: "auto" | "cpu" | "cuda" | "mps";
    dtype: "auto" | "float16" | "float32" | "int8";
    install_on_demand: boolean;
    hf_token?: string | undefined;
};
export declare function sttCfg(input?: z.input<typeof Stt>): {
    provider: "whisperx";
    model: string;
    language: string;
    timestamps: "none" | "segment" | "word";
    diarization: boolean;
    vad: boolean;
    compute_type: "float16" | "float32" | "int8";
    batch_size: number;
    beam_size: number;
};
export declare function ttsCfg(input?: z.input<typeof Tts>): {
    provider: "omnivoice";
    default_preset?: string | undefined;
    presets: {
        id: string;
        name: string;
        mode: "auto" | "clone" | "design";
        ref_audio_path?: string | undefined;
        ref_text?: string | undefined;
        instruct?: string | undefined;
        design?: {
            gender?: string | undefined;
            age?: string | undefined;
            pitch?: string | undefined;
            style?: string | undefined;
            english_accent?: string | undefined;
            chinese_dialect?: string | undefined;
        } | undefined;
        tags?: ("[confirmation-en]" | "[dissatisfaction-hnn]" | "[laughter]" | "[question-ah]" | "[question-ei]" | "[question-en]" | "[question-oh]" | "[question-yi]" | "[sigh]" | "[surprise-ah]" | "[surprise-oh]" | "[surprise-wa]" | "[surprise-yo]")[] | undefined;
        language?: string | undefined;
        speed?: number | undefined;
    }[];
    live: boolean;
    autoplay: boolean;
    chunking: "sentence";
    stop_on_interrupt: boolean;
    strip_markdown: boolean;
    speed: number;
    duration?: number | undefined;
    num_step: number;
};
export declare function voiceCfg(input?: z.input<typeof VoiceSchema>): {
    runtime: {
        enabled: boolean;
        python: string;
        device: "auto" | "cpu" | "cuda" | "mps";
        dtype: "auto" | "float16" | "float32" | "int8";
        install_on_demand: boolean;
        hf_token?: string | undefined;
    };
    stt: {
        provider: "whisperx";
        model: string;
        language: string;
        timestamps: "none" | "segment" | "word";
        diarization: boolean;
        vad: boolean;
        compute_type: "float16" | "float32" | "int8";
        batch_size: number;
        beam_size: number;
    };
    tts: {
        provider: "omnivoice";
        default_preset?: string | undefined;
        presets: {
            id: string;
            name: string;
            mode: "auto" | "clone" | "design";
            ref_audio_path?: string | undefined;
            ref_text?: string | undefined;
            instruct?: string | undefined;
            design?: {
                gender?: string | undefined;
                age?: string | undefined;
                pitch?: string | undefined;
                style?: string | undefined;
                english_accent?: string | undefined;
                chinese_dialect?: string | undefined;
            } | undefined;
            tags?: ("[confirmation-en]" | "[dissatisfaction-hnn]" | "[laughter]" | "[question-ah]" | "[question-ei]" | "[question-en]" | "[question-oh]" | "[question-yi]" | "[sigh]" | "[surprise-ah]" | "[surprise-oh]" | "[surprise-wa]" | "[surprise-yo]")[] | undefined;
            language?: string | undefined;
            speed?: number | undefined;
        }[];
        live: boolean;
        autoplay: boolean;
        chunking: "sentence";
        stop_on_interrupt: boolean;
        strip_markdown: boolean;
        speed: number;
        duration?: number | undefined;
        num_step: number;
    };
};
