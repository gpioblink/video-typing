import React, {FC} from "react";
import {Layout} from "./style";
import {PlayMode} from "../../VideoPart/VideoPlayer";
import {Count} from "../Count";
import {Mode} from "../Mode";

interface Props {
    mode: PlayMode;
    unaudibleCount: number;
    ignoranceCount: number;
    spellingCount: number;
    othersCount: number;
}

export const Score: FC<Props> = ({ mode, unaudibleCount, ignoranceCount, spellingCount, othersCount }) => {
    return (
        <Layout>
            <div className="item"><Mode mode={mode}/></div>
            <div className="item"><Count ignoranceCount={ignoranceCount} othersCount={othersCount} spellingCount={spellingCount} unaudibleCount={unaudibleCount}/></div>
        </Layout>
    );
};
