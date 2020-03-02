import React, {FC} from "react";
import {CaptionFrame, Char} from "../../index";

type TypingStatus = 'wait' | 'available' | 'mistaken' | 'finished'
interface GameChar {
    char: Char
    status: TypingStatus
}

interface States {
    gameChars: GameChar[]
}

interface Props {
    frame: CaptionFrame
    sendCompleted: () => void
}

export const Window: FC<Props> = ({ frame, sendCompleted }) => {

};
