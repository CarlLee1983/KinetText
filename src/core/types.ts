export interface Book {
    title: string;
    author: string;
    description: string;
    coverUrl?: string;
    chapters: Chapter[];
}

export interface Chapter {
    index: number;
    title: string;
    sourceUrl: string;
    content?: string;
}
