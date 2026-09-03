import React, { useEffect, useState } from 'react';

export function CustomCursor() {
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    let animationFrameId;
    
    const moveCursor = (e) => {
      // Use requestAnimationFrame for smoother performance
      animationFrameId = requestAnimationFrame(() => {
        setCursorPos({ x: e.clientX, y: e.clientY });
      });
    };
    
    const handleMouseOver = (e) => {
      if (e.target.tagName.toLowerCase() === 'a' || e.target.closest('a')) {
        setHovering(true);
      }
    };
    
    const handleMouseOut = () => setHovering(false);

    window.addEventListener('mousemove', moveCursor);
    document.body.addEventListener('mouseover', handleMouseOver);
    document.body.addEventListener('mouseout', handleMouseOut);

    return () => {
      window.removeEventListener('mousemove', moveCursor);
      document.body.removeEventListener('mouseover', handleMouseOver);
      document.body.removeEventListener('mouseout', handleMouseOut);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div 
      className={`custom-cursor hidden md:block ${hovering ? 'hovering' : ''}`} 
      style={{ left: cursorPos.x, top: cursorPos.y }}
    />
  );
}
