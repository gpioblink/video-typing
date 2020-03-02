import React from 'react';
import {GameChar, Window} from "../App/Window";
import {Char, Tag} from "../index";
import {action} from "@storybook/addon-actions";

export default {
    title: 'Window',
    components: Window,
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
    },
    {
        id: '8888',
        char: '\n',
        isTypeable: true
    },
    {
        id: '1110',
        char: '[',
        isTypeable: false
    },
    {
        id: '1111',
        char: 'L',
        isTypeable: false
    },
    {
        id: '1112',
        char: 'I',
        isTypeable: false
    },
    {
        id: '1113',
        char: 'L',
        isTypeable: false
    },
    {
        id: '1114',
        char: 'I',
        isTypeable: false
    },
    {
        id: '1115',
        char: ']',
        isTypeable: false
    },
    {
        id: '1116',
        char: ' ',
        isTypeable: false
    },
    {
        id: '1117',
        char: 'I',
        isTypeable: true
    },
    {
        id: '1118',
        char: "`",
        isTypeable: false
    },
    {
        id: '1119',
        char: 'm',
        isTypeable: true
    },
    {
        id: '110',
        char: ' ',
        isTypeable: false
    },
    {
        id: '111',
        char: 'a',
        isTypeable: true
    },
    {
        id: '112',
        char: ' ',
        isTypeable: false
    },
    {
        id: '113',
        char: 'w',
        isTypeable: true
    },
    {
        id: '114',
        char: 'r',
        isTypeable: true
    },
    {
        id: '115',
        char: 'e',
        isTypeable: true
    },
    {
        id: '116',
        char: 't',
        isTypeable: true
    },
    {
        id: '117',
        char: 'c',
        isTypeable: true
    },
    {
        id: '118',
        char: 'h',
        isTypeable: true
    },
    {
        id: '119',
        char: 'e',
        isTypeable: true
    },
    {
        id: '120',
        char: 'd',
        isTypeable: true
    },
    {
        id: '121',
        char: ' ',
        isTypeable: false
    },
    {
        id: '122',
        char: 'l',
        isTypeable: true
    },
    {
        id: '123',
        char: 'i',
        isTypeable: true
    },
    {
        id: '124',
        char: 't',
        isTypeable: true
    },
    {
        id: '125',
        char: 't',
        isTypeable: true
    },
    {
        id: '126',
        char: 'l',
        isTypeable: true
    },
    {
        id: '127',
        char: 'e',
        isTypeable: true
    },
    {
        id: '128',
        char: ' ',
        isTypeable: false
    },
    {
        id: '129',
        char: 'p',
        isTypeable: true
    },
    {
        id: '130',
        char: 'r',
        isTypeable: true
    },
    {
        id: '131',
        char: 'u',
        isTypeable: true
    },
    {
        id: '132',
        char: 'm',
        isTypeable: true
    }
];

export const ToWindow = () => (
    <Window frame={ {caption: CharsData, tags: TagsData, id: 'frgersgsr'} } sendCompleted={action('finishGame')}/>
);
