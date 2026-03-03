export interface TTSProvider {
    /**
     * Converts a text file to an audio file.
     * @param inputFilePath Path to the input .txt file
     * @param outputFilePath Path to save the resulting .mp3 file
     */
    generateAudioFromFile(inputFilePath: string, outputFilePath: string): Promise<void>
}
