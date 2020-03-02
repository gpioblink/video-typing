import React, {FC, ReactElement, useState} from "react";
import {CaptionFrame, Char, Tag} from "../../index";
import {Style} from "./style";
import {Line} from "../Line";

export type TypingStatus = 'wait' | 'available' | 'mistaken' | 'finished'
export interface GameChar {
    char: Char
    input: ''
    status: TypingStatus
}

interface Game {
    gameChars: GameChar[]
    tag: Tag[]
}

interface States {
    game: Game
}

interface Props {
    frame: CaptionFrame
    sendCompleted: () => void
}

const initializeGame = (frame: CaptionFrame):Game => {
    const gameChars:GameChar[] = [];
    frame.caption.forEach(char => {
        gameChars.push({char: char, status: 'wait', input: ''})
    });

    return {gameChars: gameChars, tag: frame.tags}
};

export const Window: FC<Props> = ({ frame, sendCompleted }) => {
    const [state, setState] = useState({game:initializeGame(frame)});

    const splitCharsByNewLine = (chars: GameChar[]):GameChar[][] => {
        const splitedGameChars: GameChar[][] = [];
        splitedGameChars.push([]);
        chars.forEach(gchar => {
            splitedGameChars[splitedGameChars.length - 1].push(gchar)
            if(gchar.char.char === '\n') {
                splitedGameChars.push([]);
            }
        });
        return splitedGameChars
    };

    return (
        <Style>
            {splitCharsByNewLine(state.game.gameChars).map(
                (chars: GameChar[]):ReactElement => {
                    return <Line key={chars[0].char.id} chars={chars} tags={frame.tags}/>
                }
            )}
        </Style>
    )
};
