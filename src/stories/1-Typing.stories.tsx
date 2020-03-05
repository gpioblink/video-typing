import React from "react";
import {Typing} from "../App/Typing";
import {YoutubeMpegData} from "./4-VideoPlayer.stories";
import {PokemonJson} from "./pokemon";

export default {
    title: 'Typing',
    components: Typing,
    excludeStories: /.*Data$/,
};

export const Default = () => (
    <Typing  caption={PokemonJson} videoSources={{sources: [YoutubeMpegData]}}/>
);
