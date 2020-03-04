import React, {FC, ReactElement} from "react";
import {Layout} from "./style";
import {DictionaryWord} from "../../../index";

interface Props {
    words: DictionaryWord[]
}

export const Hint: FC<Props> = ({words}) => {
    return (
        <Layout>
            {words.map((word):ReactElement => {
                return (<div className="item"><div className="title">{word.title}</div><div className="content">{word.content}</div></div>)
                }
            )}
        </Layout>
    );
};
