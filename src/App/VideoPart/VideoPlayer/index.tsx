import React, {createRef, FC, ReactElement, useEffect, useState} from "react";
import videojs from 'video.js';

// ultra thanks https://gist.github.com/andrewserong/799db253ad6340201ef5130f4daeaa0f

import 'video.js/dist/video-js.css'

export type CodecMIME = "video/mp4" | "application/x-mpegURL"
export interface VideoSource {
    src: string;
    type: CodecMIME;
}

export interface VideoPlayerProps {
    sources: VideoSource[];
    nativeSources?: VideoSource[];
}

export type PlayMode = "standard" | "slow" | "native"
interface Props {
    mode: PlayMode;
    playerProps: VideoPlayerProps;
}

interface State {
    player: videojs.Player;
}

export const VideoPlayer: FC<Props> = ({mode, playerProps}) => {
    const [state, setState] = useState<State>();
    const videoNode = createRef<HTMLVideoElement>();

    useEffect(() => {
        // init player
        const defaultOptions: videojs.PlayerOptions = {
            autoplay: true,
            controls: false,
            fluid: true,
            preload: 'auto',
            html5: {
                hls: {
                    enableLowInitialPlaylist: true,
                    smoothQualityChange: true,
                    overrideNative: true,
                },
            },
            sources: playerProps.sources
        };

        const player = videojs(videoNode.current, defaultOptions);
        setState({player: player});

        return () => {
            if(player !== null) {
                player.dispose();
            }
        };
    }, []);

    useEffect(() => {
        if(state?.player !== null) {
            if(mode === "native" && playerProps.nativeSources?.length) {
                state?.player.src(playerProps.nativeSources);
            } else {
                state?.player.src(playerProps.sources);
            }
        }
    }, [mode]);

    return (
        <div>
            <video ref={videoNode} className="video-js" />
        </div>
    )
};
