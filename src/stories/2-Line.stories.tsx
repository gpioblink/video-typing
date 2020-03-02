import React from 'react';
import {Line} from "../App/Line";
import {Char, Tag} from "../index";

export default {
    title: 'Line',
    components: Line,
    excludeStories: /.*Data$/,
};

export const TagsData: Tag[] = [
    {
        id: 'b6949777-91f3-4209-95d8-ee3efcd67a9f',
        pastedCharIds: ['13','14','15','16','17','18','19','20'],
        content: 'unaudible'
    },
    {
        id: '378d9486-9bb9-464e-8b91-0daed84b0eab',
        pastedCharIds: ['29','30','31','32'],
        content: 'spelling'
    },
];

export const CharsData: Char[] = [
    {
        id: '0',
        char: '[',
        isTypeable: false
    },
    {
        id: '1',
        char: 'L',
        isTypeable: false
    },
    {
        id: '2',
        char: 'I',
        isTypeable: false
    },
    {
        id: '3',
        char: 'L',
        isTypeable: false
    },
    {
        id: '4',
        char: 'I',
        isTypeable: false
    },
    {
        id: '5',
        char: ']',
        isTypeable: false
    },
    {
        id: '6',
        char: ' ',
        isTypeable: false
    },
    {
        id: '7',
        char: 'I',
        isTypeable: true
    },
    {
        id: '8',
        char: "`",
        isTypeable: false
    },
    {
        id: '9',
        char: 'm',
        isTypeable: true
    },
    {
        id: '10',
        char: ' ',
        isTypeable: false
    },
    {
        id: '11',
        char: 'a',
        isTypeable: true
    },
    {
        id: '12',
        char: ' ',
        isTypeable: false
    },
    {
        id: '13',
        char: 'w',
        isTypeable: true
    },
    {
        id: '14',
        char: 'r',
        isTypeable: true
    },
    {
        id: '15',
        char: 'e',
        isTypeable: true
    },
    {
        id: '16',
        char: 't',
        isTypeable: true
    },
    {
        id: '17',
        char: 'c',
        isTypeable: true
    },
    {
        id: '18',
        char: 'h',
        isTypeable: true
    },
    {
        id: '19',
        char: 'e',
        isTypeable: true
    },
    {
        id: '20',
        char: 'd',
        isTypeable: true
    },
    {
        id: '21',
        char: ' ',
        isTypeable: false
    },
    {
        id: '22',
        char: 'l',
        isTypeable: true
    },
    {
        id: '23',
        char: 'i',
        isTypeable: true
    },
    {
        id: '24',
        char: 't',
        isTypeable: true
    },
    {
        id: '25',
        char: 't',
        isTypeable: true
    },
    {
        id: '26',
        char: 'l',
        isTypeable: true
    },
    {
        id: '27',
        char: 'e',
        isTypeable: true
    },
    {
        id: '28',
        char: ' ',
        isTypeable: false
    },
    {
        id: '29',
        char: 'p',
        isTypeable: true
    },
    {
        id: '30',
        char: 'r',
        isTypeable: true
    },
    {
        id: '31',
        char: 'u',
        isTypeable: true
    },
    {
        id: '32',
        char: 'm',
        isTypeable: true
    }
];

export const ToLine = () => (
    <Line chars={CharsData} tags={TagsData} />
);
