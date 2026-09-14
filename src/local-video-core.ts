function fileName(path: string): string {
  return path.split(/[\\/]/u).pop() ?? "";
}

function extension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function stem(name: string): string {
  const suffix = extension(name);
  return suffix === "" ? name : name.slice(0, -suffix.length);
}

export function isSupportedLocalVideoPath(path: string): boolean {
  return extension(fileName(path)) === ".mp4";
}

export function isSupportedLocalSubtitlePath(path: string): boolean {
  const suffix = extension(fileName(path));
  return suffix === ".srt" || suffix === ".vtt";
}

export function findMatchingLocalSubtitleNames(
  videoPath: string,
  candidateNames: readonly string[]
): string[] {
  const videoStem = stem(fileName(videoPath)).toLowerCase();
  return candidateNames
    .filter(isSupportedLocalSubtitlePath)
    .map((name) => {
      const subtitleStem = stem(fileName(name)).toLowerCase();
      const sameBase = subtitleStem === videoStem;
      const relatedBase = [".", "-", "_", " "].some((separator) =>
        subtitleStem.startsWith(`${videoStem}${separator}`)
      );
      if (!sameBase && !relatedBase) {
        return null;
      }
      const english = /(?:^|[._ &-])(?:en|eng|english)(?:$|[._ &-])/u.test(subtitleStem);
      const knownNonEnglish = /(?:^|[._ &-])(?:zh|chs|cht|cn|ja|jpn|ko|kor|fr|de|es)(?:$|[._ &-])/u
        .test(subtitleStem);
      if (knownNonEnglish && !english) {
        return null;
      }
      return {
        name,
        score: english ? 0 : sameBase ? 1 : 2
      };
    })
    .filter((item): item is { name: string; score: number } => item !== null)
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
    .map((item) => item.name);
}
