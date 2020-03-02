import React, {FC, ReactElement} from "react";
import {Char, ID, Tag} from "../../index";
import {Style} from "./style";
import {CharView} from "../CharView";
import {TagContentView} from "../TagContentView";
import {TagPosition} from "../TagContentView/style";
import {TagLineView} from "../TagLineView";

interface Props {
    // CaptionWindowで改行前で分割されたもの
    chars: Char[]
    tags: Tag[]
}

export const Line: FC<Props> = ({ chars, tags }) => {
    const calcTagPosition = (tag: Tag): TagPosition  => {
        // そのtagのついているcharのリストを取得し、そのindexをとる
        const charIndexList:number[] = [];
        chars.map((char, index) => {
           if(tag.pastedCharIds.includes(char.id)) {
               charIndexList.push(index)
           }
           return false
        });

        // tagの範囲としてindexの最大最小範囲を指定
        return {startPosition: Math.min(...charIndexList), lastPosition: Math.max(...charIndexList)}
    };

    return(
        <Style>
            {chars.map(
                (char: Char):ReactElement => {
                    return <CharView key={char.id} char={char}/>
                })
            }
            {tags.map(
                (tag: Tag):ReactElement => {
                    return <TagLineView key={tag.id} position={calcTagPosition(tag)} />
                }
            )}
            {tags.map(
                (tag: Tag):ReactElement => {
                    return <TagContentView key={tag.id} tag={tag} position={calcTagPosition(tag)} />
                }
            )}
        </Style>
    )
};
