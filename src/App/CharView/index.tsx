import React, {FC} from "react";
import {Layout} from "./style";
import {GameChar} from "../Window";

interface Props {
    char: GameChar
}

export const CharView: FC<Props> = ({ char }) => {
    return(
        <Layout className={char.status}>{char.char.char}</Layout>
    )
};
