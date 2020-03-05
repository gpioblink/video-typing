import React from "react";
import {Typing} from "../App/Typing";
import {PokemonJson, PokemonYoutubeMediaSource, PokemonYoutubeSource} from "./pokemon";

export default {
    title: 'Typing',
    components: Typing,
    excludeStories: /.*Data$/,
};

export const Default = () => (
    <Typing  caption={PokemonJson} videoSources={{sources: [PokemonYoutubeMediaSource]}}/>
);
