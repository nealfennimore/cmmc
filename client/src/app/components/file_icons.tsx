// File-type icons and the type -> icon mapping, shared by the evidence
// badges, the evidence table, and its stat cards.
import {
    isCode,
    isCSV,
    isDoc,
    isImage,
    isMusic,
    isPDF,
    isPowerpoint,
    isSheet,
    isVideo,
    isWord,
    isZip,
} from "@/app/utils/file";

export const IconFileDownload = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-4 mr-1"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M20 12.5V6.8c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C17.72 2 16.88 2 15.2 2H8.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C4 4.28 4 5.12 4 6.8v10.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C6.28 22 7.12 22 8.8 22h3.7m2.5-3 3 3m0 0 3-3m-3 3v-6"
        />
    </svg>
);

export const IconFileImage = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            fill="currentColor"
            d="M16 18H8l2.5-6 2 4 1.5-2zm-1-8.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0"
        />
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m14-4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1M8 18h8l-2-4-1.5 2-2-4zm7-8.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0"
        />
    </svg>
);

export const IconFileZip = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m14-4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1Zm-4 1h.01v.01H15zm-2 2h.01v.01H13zm2 2h.01v.01H15zm-2 2h.01v.01H13zm2 2h.01v.01H15zm-2 2h.01v.01H13zm2 2h.01v.01H15zm-2 2h.01v.01H13z"
        />
    </svg>
);

export const IconFileWord = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m4 4 1 5 2-3.333L14 17l1-5m4-8v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1"
        />
    </svg>
);

export const IconFileVideo = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m14-4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1ZM9 12h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Zm5.697 2.395v-.733l1.269-1.219v2.984l-1.268-1.032Z"
        />
    </svg>
);

export const IconFilePowerpoint = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 17v-5h1.5a1.5 1.5 0 1 1 0 3H5m6 2v-5h1.5a1.5 1.5 0 1 1 0 3H11m7-3v5m-1-5h2M5 10V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1v6M5 19v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1M10 3v4a1 1 0 0 1-1 1H5"
        />
    </svg>
);

export const IconFilePDF = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 17v-5h1.5a1.5 1.5 0 1 1 0 3H5m12 2v-5h2m-2 3h2M5 10V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1v6M5 19v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1M10 3v4a1 1 0 0 1-1 1H5m6 4v5h1.375A1.627 1.627 0 0 0 14 15.375v-1.75A1.627 1.627 0 0 0 12.375 12z"
        />
    </svg>
);

export const IconFileMusic = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m8 7.5V8s3 1 3 4m3-8v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1m-6 12c0 1.105-1.12 2-2.5 2S8 17.105 8 16s1.12-2 2.5-2 2.5.895 2.5 2"
        />
    </svg>
);

export const IconFileDoc = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 10V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1v6M5 19v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1M10 3v4a1 1 0 0 1-1 1H5m14 9.006h-.335a1.647 1.647 0 0 1-1.647-1.647v-1.706a1.647 1.647 0 0 1 1.647-1.647L19 12M5 12v5h1.375A1.626 1.626 0 0 0 8 15.375v-1.75A1.626 1.626 0 0 0 6.375 12zm9 1.5v2a1.5 1.5 0 0 1-1.5 1.5v0a1.5 1.5 0 0 1-1.5-1.5v-2a1.5 1.5 0 0 1 1.5-1.5v0a1.5 1.5 0 0 1 1.5 1.5"
        />
    </svg>
);

export const IconFileCSV = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 10V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1v6M5 19v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1M10 3v4a1 1 0 0 1-1 1H5m2.665 9H6.647A1.647 1.647 0 0 1 5 15.353v-1.706A1.647 1.647 0 0 1 6.647 12h1.018M16 12l1.443 4.773L19 12m-6.057-.152-.943-.02a1.34 1.34 0 0 0-1.359 1.22 1.32 1.32 0 0 0 1.172 1.421l.536.059a1.273 1.273 0 0 1 1.226 1.718c-.2.571-.636.754-1.337.754h-1.13"
        />
    </svg>
);

export const IconFileCode = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M10 3v4a1 1 0 0 1-1 1H5m5 4-2 2 2 2m4-4 2 2-2 2m5-12v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7.914a1 1 0 0 1 .293-.707l3.914-3.914A1 1 0 0 1 9.914 3H18a1 1 0 0 1 1 1"
        />
    </svg>
);

export const IconExternal = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        className="h-4 mr-1"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M21 9V3m0 0h-6m6 0-8 8m-3-6H7.8c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C3 7.28 3 8.12 3 9.8v6.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C5.28 21 6.12 21 7.8 21h6.4c1.68 0 2.52 0 3.162-.327a3 3 0 0 0 1.311-1.311C19 18.72 19 17.88 19 16.2V14"
        />
    </svg>
);

export const IconLink = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13.213 9.787a3.391 3.391 0 0 0-4.795 0l-3.425 3.426a3.39 3.39 0 0 0 4.795 4.794l.321-.304m-.321-4.49a3.39 3.39 0 0 0 4.795 0l3.424-3.426a3.39 3.39 0 0 0-4.794-4.795l-1.028.961"
        />
    </svg>
);

export const IconTable = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        aria-hidden="true"
        className="h-4 mr-1"
        viewBox="0 0 24 24"
    >
        <path
            stroke="currentColor"
            strokeWidth="2"
            d="M3 11h18M3 15h18m-9-4v8m-8 0h16a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1Z"
        />
    </svg>
);

export const getIcon = (type: string): JSX.Element => {
    if (type === "url") {
        return <IconLink />;
    }
    if (isImage(type)) {
        return <IconFileImage />;
    }
    if (isPDF(type)) {
        return <IconFilePDF />;
    }
    if (isWord(type)) {
        return <IconFileWord />;
    }
    if (isPowerpoint(type)) {
        return <IconFilePowerpoint />;
    }
    if (isCSV(type)) {
        return <IconFileCSV />;
    }
    if (isCode(type)) {
        return <IconFileCode />;
    }
    if (isDoc(type)) {
        return <IconFileDoc />;
    }
    if (isMusic(type)) {
        return <IconFileMusic />;
    }
    if (isVideo(type)) {
        return <IconFileVideo />;
    }
    if (isZip(type)) {
        return <IconFileZip />;
    }
    return <IconFileDownload />;
};

/** Like {@link getIcon}, but spreadsheet types collapse to the table glyph
 *  (the stat cards label .xls/.xlsx/CSV together as "Spreadsheet"). */
export const getIconWithSheet = (type: string): JSX.Element => {
    if (isSheet(type)) {
        return <IconTable />;
    }
    return getIcon(type);
};
