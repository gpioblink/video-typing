import React, {FC, ReactElement} from "react";
import {Char, ID, Tag} from "../../../index";
import {Style} from "./style";
import {CharView} from "../CharView";
import {TagContentView} from "../TagContentView";
import {TagPosition} from "../TagContentView/style";
import {TagLineView} from "../TagLineView";
import {GameChar} from "../Window";

interface Props {
    // CaptionWindowで改行前で分割されたもの
    chars: GameChar[]
    tags: Tag[]
}

export const Line: FC<Props> = ({ chars, tags }) => {
    const calcTagPosition = (tag: Tag): TagPosition  => {
        // そのtagのついているcharのリストを取得し、そのindexをとる
        const charIndexList:number[] = [];
        chars.map((char, index) => {
           if(tag.pastedCharIds.includes(char.char.id)) {
               charIndexList.push(index)
           }
           return false
        });

        // そもそもタグが使われてないときは-1を返す
        if(charIndexList.length == 0) {
            return {startPosition: -1, lastPosition: -1};
        }

        // tagの範囲としてindexの最大最小範囲を指定
        return {startPosition: Math.min(...charIndexList), lastPosition: Math.max(...charIndexList)}
    };

    return(
        <Style>
            {chars.map(
                (char: GameChar):ReactElement => {
                    return <CharView key={char.char.id} char={char}/>
                })
            }
            {tags.map(
                (tag: Tag):ReactElement|null => {
                    const tagPosition: TagPosition = calcTagPosition(tag);
                    if(tagPosition.startPosition === -1 && tagPosition.lastPosition === -1) {
                        return null
                    }
                    return <TagLineView key={tag.id} position={tagPosition} />
                }
            )}
            {tags.map(
                (tag: Tag):ReactElement|null => {
                    const tagPosition: TagPosition = calcTagPosition(tag);
                    if(tagPosition.startPosition === -1 && tagPosition.lastPosition === -1) {
                        return null
                    }
                    return <TagContentView key={tag.id} tag={tag} position={tagPosition} />
                }
            )}
        </Style>
    )
};
