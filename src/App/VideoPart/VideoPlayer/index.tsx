import React, {createRef, FC, ReactElement, useEffect, useState} from "react";
import videojs from 'video.js';
import "videojs-youtube/dist/Youtube.min";

// ultra thanks https://gist.github.com/andrewserong/799db253ad6340201ef5130f4daeaa0f

import 'video.js/dist/video-js.css'

export type CodecMIME = "video/mp4" | "application/x-mpegURL" | "video/youtube"
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
    startTime?: number;
    endTime?: number;
    playerProps: VideoPlayerProps;
}

interface State {
    player: videojs.Player;
}

export const VideoPlayer: FC<Props> = ({mode, startTime, endTime, playerProps}) => {
    const [state, setState] = useState<State>();
    const videoNode = createRef<HTMLVideoElement>();

    const onTimeUpdated = () => {
        const time = videoNode.current?.currentTime;
        const start:number = startTime || 0;
        const end:number = endTime || videoNode.current?.duration || -1;

        if (videoNode.current && time && (time+1 < start || time >= end) ) {
            videoNode.current.currentTime = start;
        }
    };

    useEffect(() => {
        // init player
        const defaultOptions: videojs.PlayerOptions = {
            autoplay: true,
            controls: true,
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
    }, [mode, playerProps]);

    return (
        <div>
            <video ref={videoNode} onTimeUpdate={onTimeUpdated} className="video-js vjs-16-9" />
        </div>
    )
};
