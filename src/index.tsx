import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';

export type TagContent = 'unaudible' | 'ignorance' | 'spelling' | 'others'
export type ID = string
export interface Tag {
    id: ID
    pastedCharIds: ID[]
    content: TagContent
}

export interface Char {
    id: ID
    char: string // 同じキャプション内なら改行もcharとして扱う
    isTypeable: boolean
}

export interface CaptionFrame {
    id: ID
    caption: Char[]
    tags: Tag[]
}

export interface Caption {
    startTime: number;
    endTime: number;
    content: CaptionFrame
}

export interface DictionaryWord {
    title: string;
    content: string;
}

ReactDOM.render(<App />, document.getElementById('root'));

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
