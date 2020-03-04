import React from "react";
import {Score} from "../App/ScorePart/Score";

export default {
    title: 'Score',
    components: Score,
    excludeStories: /.*Data$/,
};

export const Default = () => (
    <Score mode={"native"} unaudibleCount={30} spellingCount={43} ignoranceCount={22} othersCount={332}/>
);
