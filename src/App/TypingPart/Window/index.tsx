import React, {FC, ReactElement, useEffect, useState} from "react";
import {CaptionFrame, Char, ID, Tag, TagContent} from "../../../index";
import {Style} from "./style";
import {Line} from "../Line";
import {v1 as uuidv1} from 'uuid';

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

export interface KeyboardLog {
    timeStamp: number; // ホントはuuidv1使ったほうがいいのでは？
    pushedKey: string;
    currentCharId: ID;
    isCorrect: boolean;
}

interface KeyboardLogState {
    keyboardLog: KeyboardLog[]
}

interface Props {
    frame: CaptionFrame;
    sendCompleted: () => void; // TODO: 実際はステートを保存する用にCaptionFrameを返して親でセーブしてもらう
    requestExplanation: (query: string) => void; // TODO: 実際は復習時に間違えた文とかも再確認できるようにid返しとかする。設計やり直したほうがいい気も。。
    sendMistake: (reason: TagContent) => void; // TODO: 完全にプロトタイプ用。少なくともState自体を親階層に持ってくべきだと思う。若干親がキーボード判定処理で膨れるかなぁ？
}

const initializeGame = (frame: CaptionFrame):Game => {
    const gameChars:GameChar[] = [];

    frame.caption.forEach(char => {
        gameChars.push({char: char, status: 'wait', input: '_'})
    });

    // 最初の1回はここで: gameCharsの中でstateがwaitかつ書き換え可能1番若いものを取得し、availableにしてstateを更新
    const waitIndex = gameChars.findIndex(gameChar => gameChar.status === "wait" && gameChar.char.isTypeable);

    if(waitIndex !== -1) {
        gameChars[waitIndex].status = "available";
    }

    return {gameChars: gameChars, tag: frame.tags}
};

const CharArrayToString = (chars: Char[]): string => {
    const stringArray = chars.map<string>(char => char.char);
    return stringArray.join('')
};

export const Window: FC<Props> = ({ frame, sendCompleted, requestExplanation, sendMistake }) => {
    const [state, setState] = useState({game:initializeGame(frame)} as States);
    const initKeyboardLog: KeyboardLog[] = [];
    const [keyboardState, setKeyboardState] = useState({keyboardLog: initKeyboardLog} as KeyboardLogState);
    const keyboardElement = React.createRef<HTMLDivElement>();

    // キャプションが変わったら全部初期化し直し
    useEffect(() => {
        setState({game:initializeGame(frame)} as States);
        setKeyboardState({keyboardLog: initKeyboardLog} as KeyboardLogState);
    }, [frame.id]);

    const addKeyboardLog = (pressedKey: string, currentCharId: string, isCorrect: boolean): void => {
        const timeStamp = Date.now();
        setKeyboardState((keyboardState: KeyboardLogState) => {
            const keyboardLogs = keyboardState.keyboardLog;
            keyboardLogs.push({currentCharId: currentCharId, isCorrect: isCorrect, pushedKey: pressedKey, timeStamp: timeStamp});
            return {keyboardLog: keyboardLogs}
        });
    };

    const addTag = (tag: Tag) => { // TODO: 本当は親自体にもタグを追加する
        setState((state: States) => {
            const currentTag = state.game.tag;
            currentTag.push(tag);
            return { game: { gameChars: state.game.gameChars, tag: currentTag } }
        });
    };

    const judgeTag = (currentCharId: ID) => { // TODO: この関数絶対粒度変だろ
        // currentCharIdのキャプション上のインデックスを取得
        const charIndexOnCaption = frame.caption.findIndex(captionChar => captionChar.id === currentCharId);
        if(charIndexOnCaption === -1) {
            return;
        }

        // currentCharIdを含み直前の入力不可能文字までのcharIdを取得
        const targetCharIds:string[] = [];
        let wordHeadIndex = 0;
        for(wordHeadIndex = charIndexOnCaption; wordHeadIndex >= 0; wordHeadIndex--) {
            if(!frame.caption[wordHeadIndex].isTypeable) {
                break;
            }
            targetCharIds.push(frame.caption[wordHeadIndex].id);
        }

        // useId上のkeyboardLogの取得
        const targetKeyboardLogs: KeyboardLog[] = keyboardState.keyboardLog.filter(keyLog => targetCharIds.includes(keyLog.currentCharId));

        // 以下、プロトタイプ用Tag判定ロジック

        // 1. その単語内で全て正解していた場合は何もしない
        if(targetKeyboardLogs.filter(keyLog => !keyLog.isCorrect).length === 0) {
            return
        }

        // この時点でミスしているのは確実なので、解説表示を要求する
        requestExplanation(CharArrayToString(frame.caption.slice(wordHeadIndex+1)));

        // 2. falseの数がその単語内で2回までの場合は「スペルミス」判定
        if(targetKeyboardLogs.filter(keyLog => !keyLog.isCorrect).length <= 2) {
            addTag({content: "spelling", id: uuidv1(), pastedCharIds: targetCharIds});
            sendMistake("spelling");
            return
        }

        // 3. 特定の1文字で3回以上間違えている場合は「アンオーディブル」判定
        // TODO: lodashでも使ったら？
        if(targetCharIds.filter(charId => {
            return targetKeyboardLogs.filter(keyLog => !keyLog.isCorrect && keyLog.currentCharId === charId).length >= 3
        }).length > 0) {
            addTag({content: "unaudible", id: uuidv1(), pastedCharIds: targetCharIds});
            sendMistake("unaudible");
            return
        }

        // 4. 3文字以上の場所で間違えている場合は「イグノランス」判定
        if(targetCharIds.filter(charId => {
            return targetKeyboardLogs.filter(keyLog => !keyLog.isCorrect && keyLog.currentCharId === charId).length > 0
        }).length > 0) {
            addTag({content: "ignorance", id: uuidv1(), pastedCharIds: targetCharIds});
            sendMistake("ignorance");
            return
        }

        // 5. いずれにも該当しないミスは「その他」判定
        addTag({content: "others", id: uuidv1(), pastedCharIds: targetCharIds});
        sendMistake("others");
        return
    };

    const focusWindow = () => {
        keyboardElement.current.focus();
    };

    useEffect(() => {
            document.body.addEventListener('click', focusWindow); // 画面のどこかclickされたら入力状態へ
        }
    );

    useEffect(() => {
        // そもそも入力できるデータがない場合はすぐに終了して飛ばす
        const isAnyTypeable = state.game.gameChars.filter( gameChar => gameChar.char.isTypeable).length !== 0;
        if(!isAnyTypeable) {
            sendCompleted();
        }
    }, []);

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

            if(e.key.toLowerCase() === state.game.gameChars[inputIndex].char.char.toLocaleLowerCase()) {
                // 入力が正解の場合
                editingState.game.gameChars[inputIndex].status = 'finished';

                // キーボード入力の保存
                addKeyboardLog(e.key, state.game.gameChars[inputIndex].char.id, true);

                // gameCharsの中でstateがwaitかつ書き換え可能1番若いものを取得し、availableにしてstateを更新
                const waitIndex = state.game.gameChars.findIndex(gameChar => gameChar.status === "wait" && gameChar.char.isTypeable);

                // 次の入力文字がない場合と次の文字がスペースなど入力不可能な文字な場合は区切とみなしてタグ付け判断をする
                // const isAnyTypeable = state.game.gameChars.filter( gameChar => gameChar.char.isTypeable).length !== 0;
                if(waitIndex === -1 || inputIndex+1 !== waitIndex) {
                    judgeTag(state.game.gameChars[inputIndex].char.id);
                }

                if(waitIndex !== -1) {
                    editingState.game.gameChars[waitIndex].status = "available";
                }

                if(waitIndex === -1) {
                    sendCompleted();
                }
            } else {
                // 入力が不正解の場合
                editingState.game.gameChars[inputIndex].status = 'mistaken';

                // キーボード入力の保存
                addKeyboardLog(e.key, state.game.gameChars[inputIndex].char.id, false);
            }

            return editingState;
        });
    };

    return (
        <Style onKeyPress={ e => onKeyPress(e) } tabIndex={0} ref={keyboardElement}>
            {splitCharsByNewLine(state.game.gameChars).map(
                (chars: GameChar[]):ReactElement => {
                    return <Line key={chars[0].char.id} chars={chars} tags={frame.tags}/>
                }
            )}
        </Style>
    )
};
