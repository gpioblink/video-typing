import React, {FC, ReactElement} from "react";
import {Layout} from "./style";
import {GameChar} from "../Window";

interface Props {
    char: GameChar
}

export const CharView: FC<Props> = ({ char }) => {

    const generateChar = (): ReactElement => {
        // if(char.char.char === '\n') {
        //     return <Layout> </Layout>;
        // }

        if(char.char.isTypeable) {
            switch(char.status) {
                case "wait":
                    return <Layout><div className="wait">_</div></Layout>;
                case "available":
                    return <Layout><div className="available">_</div></Layout>;
                case "mistaken":
                    return <Layout><div className="mistaken">{char.input}</div></Layout>;
                case "finished":
                    return <Layout><div className="finished">{char.char.char}</div></Layout>;
            }
        }

        return <Layout className={char.status}><div className="wait">{char.char.char}</div></Layout>;
    };

    return generateChar()

};
