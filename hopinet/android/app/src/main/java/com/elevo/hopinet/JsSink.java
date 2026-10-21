package com.elevo.hopinet;

/** Receives JavaScript snippets to evaluate in the game WebView. */
public interface JsSink {
    void run(String js);
}
