import React from "react";
import {Typing} from "../App/Typing";

export default {
    title: 'Typing',
    components: Typing,
    excludeStories: /.*Data$/,
};

export const Default = () => (
    <Typing />
);
