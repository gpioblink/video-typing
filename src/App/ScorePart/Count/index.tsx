import React, {FC} from "react";
import {Layout} from "./style";

interface Props {
    unaudibleCount: number;
    ignoranceCount: number;
    spellingCount: number;
    othersCount: number;
}

export const Count: FC<Props> = ({ unaudibleCount, ignoranceCount, spellingCount, othersCount }) => {
    return (
        <Layout>
            <div className="score">unaudible<div className="number">{unaudibleCount}</div></div>
            <div className="score">ignorance<div className="number">{ignoranceCount}</div></div>
            <div className="score">spelling<div className="number">{spellingCount}</div></div>
            <div className="score">others<div className="number">{othersCount}</div></div>
        </Layout>
    );
};
