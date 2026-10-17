// Hand-authored synthetic XML following the public AlphaTheta format. No user's paths/music.
export const REKORDBOX_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0"><PRODUCT Name="rekordbox" Version="7" Company="AlphaTheta"/>
<COLLECTION Entries="2">
<TRACK TrackID="10" Name="Soft &amp; Warm" Artist="Synthetic Artist" Genre="House" AverageBpm="122.5" TotalTime="330" Tonality="Am" Rating="204" Location="file://localhost/Music/Soft%20%26%20Warm.mp3" Comments="Intro&#10;Keep vocals clear" Album="Synthetic Album">
<TEMPO Inizio="0.025" Bpm="122.5" Metro="4/4" Battito="1"/>
<TEMPO Inizio="64.125" Bpm="123" Metro="4/4" Battito="2"/>
<POSITION_MARK Name="Intro" Type="0" Start="0.125" Num="-1"/>
<POSITION_MARK Name="Drop" Type="0" Start="64.451" Num="0" Red="255" Green="120" Blue="0"/>
<POSITION_MARK Name="Loop" Type="4" Start="128.25" End="144.75" Num="7"/>
</TRACK>
<TRACK TrackID="20" Name="Golden Hour" Artist="Synthetic Artist" Genre="Deep House" AverageBpm="124" TotalTime="360" Tonality="9A" Rating="255" Location="file://localhost/C:/Music/Golden%20Hour.flac" Comments="Check phrasing"/>
</COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT" Count="1"><NODE Type="0" Name="Weekend" Count="2">
<NODE Type="1" Name="Warmup" KeyType="0" Entries="3"><TRACK Key="10"/><TRACK Key="20"/><TRACK Key="10"/></NODE>
<NODE Type="1" Name="By Location" KeyType="1" Entries="1"><TRACK Key="file://localhost/C:/Music/Golden%20Hour.flac"/></NODE>
</NODE></NODE></PLAYLISTS></DJ_PLAYLISTS>`;
