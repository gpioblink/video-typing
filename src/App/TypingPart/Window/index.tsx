import React, {FC, ReactElement, useState} from "react";
import {CaptionFrame, Char, Tag} from "../../../index";
import {Style} from "./style";
import {Line} from "../Line/index";

export type TypingStatus = 'wait' | 'available' | 'mistaken' | 'finished'
export interface GameChar {
    char: Char
    input: string
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
        gameChars.push({char: char, status: 'wait', input: '_'})
    });

    // 最初の1回はここで: gameCharsの中でstateがwaitかつ書き換え可能1番若いものを取得し、availableにしてstateを更新
    const waitIndex = gameChars.findIndex(gameChar => gameChar.status === "wait" && gameChar.char.isTypeable);
    gameChars[waitIndex].status = "available";

    return {gameChars: gameChars, tag: frame.tags}
};

export const Window: FC<Props> = ({ frame, sendCompleted }) => {
    const [state, setState] = useState({game:initializeGame(frame)} as States);

    const splitCharsByNewLine = (chars: GameChar[]):GameChar[][] => {
        const splitedGameChars: GameChar[][] = [];
        splitedGameChars.push([]);
        chars.forEach(gchar => {
            splitedGameChars[splitedGameChars.length - 1].push(gchar);
            if(gchar.char.char === '\n') {
                splitedGameChars.push([]);
            }
        });
        return splitedGameChars
    };

    const onKeyPress = (e: React.KeyboardEvent<HTMLDivElement>): void => {
        e.stopPropagation();
        e.persist(); // TODO: persistとかあんまよくない気がする。。（しろうと

        setState((state: States): States => {
            const editingState: States = Object.create(state);

            // available(入力対象)を取得
            const inputIndex = editingState.game.gameChars.findIndex(gameChar => (gameChar.status === "available" || gameChar.status === "mistaken") && gameChar.char.isTypeable);

            if(inputIndex === -1) {
                return state
            }

            editingState.game.gameChars[inputIndex].input = e.key;

            if(e.key === state.game.gameChars[inputIndex].char.char) {
                // 入力が正解の場合
                editingState.game.gameChars[inputIndex].status = 'finished';

                // gameCharsの中でstateがwaitかつ書き換え可能1番若いものを取得し、availableにしてstateを更新
                const waitIndex = state.game.gameChars.findIndex(gameChar => gameChar.status === "wait" && gameChar.char.isTypeable);

                // もしなかったら、sendCompletedを親に通知して終了
                if(waitIndex === -1) {
                    sendCompleted();
                    return editingState
                }
                editingState.game.gameChars[waitIndex].status = "available";

            } else {
                // 入力が不正解の場合
                editingState.game.gameChars[inputIndex].status = 'mistaken';
            }

            return editingState;
        });
    };

    return (
        <Style onKeyPress={ e => onKeyPress(e) } tabIndex={0}>
            {splitCharsByNewLine(state.game.gameChars).map(
                (chars: GameChar[]):ReactElement => {
                    return <Line key={chars[0].char.id} chars={chars} tags={frame.tags}/>
                }
            )}
        </Style>
    )
};
