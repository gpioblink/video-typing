import React from "react";
import {Count} from "../App/ScorePart/Count";

export default {
  title: 'Count',
  components: Count,
    excludeStories: /.*Data$/,
};

export const Default = () => (
  <Count unaudibleCount={30} spellingCount={43} ignoranceCount={22} othersCount={332}/>
);
