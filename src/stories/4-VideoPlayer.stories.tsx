import React from 'react';
import {VideoPlayer, VideoPlayerProps, VideoSource} from "../App/VideoPart/VideoPlayer";

export default {
    title: 'VideoPlayer',
    components: VideoPlayer,
    excludeStories: /.*Data$/,
};

export const YoutubeMpegData: VideoSource = {
    src: "https://bitdash-a.akamaihd.net/content/MI201109210084_1/m3u8s/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.m3u8",
    type: "application/x-mpegURL"
};

export const Default = () => (
    <VideoPlayer mode={"standard"} playerProps={{sources: [YoutubeMpegData]}} />
);

export const RangeRepeat = () => (
    <VideoPlayer mode={"standard"} startTime={5} endTime={10} playerProps={{sources: [YoutubeMpegData]}} />
);
