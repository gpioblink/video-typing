import React from "react";
import {Typing} from "../App/Typing";
import {YoutubeMpegData} from "./4-VideoPlayer.stories";
import {CharsData} from "./2-Line.stories";
import {TagsData, CharsData as CharsData2} from "./3-Window.stories";

export default {
    title: 'Typing',
    components: Typing,
    excludeStories: /.*Data$/,
};

export const Default = () => (
    <Typing  caption={[{startTime: 20, endTime: 28, content: {caption: CharsData, tags: TagsData, id: 'frgersgsr'}}, {startTime: 100, endTime: 120, content: {caption: CharsData2, tags: TagsData, id: 'geatergh'}}, ]} videoSources={{sources: [YoutubeMpegData]}}/>
);
