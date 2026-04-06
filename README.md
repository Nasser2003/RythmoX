# Tauri + React + Typescript
to build:
```bash
npm run tauri build
# out: src-tauri/target/release/bundle/nsis/
```

# Origin of lightweigt ffmpeg exe
How did I build a extreme lightweight ffmpeg exe instead of the heavy one that is available online directly?

## Install msys2
Since I'm on Windows, i have to install msys2. It will be usefull to run `make` commandes.

## Download essential tools
- open msys2
- choose a random location where you want to download ffmpeg files for compilation. For example `cd %userprofile%\dev`
- Install essentials tools
```bash
pacman -S --needed base-devel git mingw-w64-ucrt-x86_64-toolchain mingw-w64-ucrt-x86_64-x264 mingw-w64-ucrt-x86_64-nasm
# [enter to select all]
```

## Clone ffmpeg github project
```bash
git clone https://git.ffmpeg.org/ffmpeg.git ffmpeg-src
cd ffmpeg-src
```

## Build the exe file with minimal config needed for our application
```bash
./configure --disable-everything \
  --enable-encoder=libx264 --enable-encoder=aac --enable-encoder=wrapped_avframe \
  --enable-decoder=h264 --enable-decoder=aac --enable-decoder=pcm_s16le \
  --enable-filter=scale --enable-filter=overlay --enable-filter=format --enable-filter=color --enable-filter=split --enable-filter=nullsrc \
  --enable-libx264 --enable-gpl \
  --enable-protocol=file \
  --enable-muxer=mov --enable-muxer=mp4 \
  --enable-demuxer=mov --enable-demuxer=mp4 \
  --disable-doc --disable-avdevice --disable-swscale-alpha \
  --disable-debug --disable-shared --enable-static

make -j$(nproc)
```

# Features to implement:
- fix dialog exact letter split
- ~~add start page to load recent files,...~~
- ~~improve file ui design like on most softwares (file, edit, help)~~
- ~~implement CTRL+Z~~
- ~~improve export progression bar calculation~~
- ~~apply group settings when multiple dialogs are selected~~
- ~~save zoom and view pos settings in project and load~~
- ~~when scroll, based on the red cursor pos.~~
- ~~for this internal cut, add the list in additional settings of the dialog~~
- ~~add bold, underline, cross to additionnal param to dialogs~~
- ~~internal cut in dialog + drag possible to stretch some long sylabs.~~
- ~~fix export preview that doesn't show sometimes~~
- ~~in the export result, make the dialogue more filled instead of margin~~
- ~~right click dialog: define as default style~~
- ~~optimize app performance + video sub resolution~~