/**
 * Type declarations for Screenplay commands
 *
 * Extends TipTap's Commands interface to include our custom screenplay commands
 */

import '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    screenplayKit: {
      /**
       * Set the current block to Action element
       */
      setAction: () => ReturnType;

      /**
       * Set the current block to Scene Heading element
       */
      setSceneHeading: () => ReturnType;

      /**
       * Set the current block to Character element
       */
      setCharacter: () => ReturnType;

      /**
       * Set the current block to Dialogue element
       */
      setDialogue: () => ReturnType;

      /**
       * Set the current block to Parenthetical element
       */
      setParenthetical: () => ReturnType;

      /**
       * Set the current block to Transition element
       */
      setTransition: () => ReturnType;
    };
  }
}
