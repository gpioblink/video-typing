import React from "react";
import {Mode} from "../App/ScorePart/Mode";

export default {
    title: 'Mode',
    components: Mode,
    excludeStories: /.*Data$/,
};

export const Default = () => (
    <Mode mode={"standard"} />
);

export const Slow = () => (
    <Mode mode={"slow"} />
);

export const Native = () => (
    <Mode mode={"native"} />
);
